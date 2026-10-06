import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 10_000;
const REALTIME_TIMEOUT_MS = 5_000;
const REALTIME_DENIAL_WINDOW_MS = 1_500;
const TEST_PASSWORD = `${randomBytes(32).toString('base64url')}Aa9!`;

class AcceptanceError extends Error {}

function assert(condition, message) {
  if (!condition) throw new AcceptanceError(message);
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AcceptanceError(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function extractStatusCredentials(status) {
  const entries = [];
  const collect = (object, prefix = '') => {
    for (const [key, value] of Object.entries(object ?? {})) {
      const normalizedKey = key.toLowerCase().replaceAll('-', '_');
      const path = prefix ? `${prefix}.${normalizedKey}` : normalizedKey;
      if (value && typeof value === 'object' && !Array.isArray(value)) collect(value, path);
      else entries.push([path, value]);
    }
  };
  collect(status);
  const find = (names) => {
    const match = entries.find(([key]) => names.some((name) => key === name || key.endsWith(`.${name}`)));
    return match?.[1];
  };
  return {
    url: process.env.SUPABASE_URL ?? find(['api_url', 'supabase_url', 'api.url']),
    anonKey: process.env.SUPABASE_ANON_KEY ?? find(['anon_key', 'publishable_key', 'anon', 'keys.anon']),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? find(['service_role_key', 'secret_key', 'service_role', 'keys.service_role', 'keys.secret']),
  };
}

async function getLocalCredentials() {
  let status;
  if (process.env.SUPABASE_STATUS_JSON) {
    try {
      status = JSON.parse(process.env.SUPABASE_STATUS_JSON);
    } catch {
      throw new AcceptanceError('SUPABASE_STATUS_JSON is not valid JSON. Provide the output of `supabase status --output json`.');
    }
  } else {
    try {
      const cliEntrypoint = resolve(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
      const { stdout } = await execFileAsync(process.execPath, [cliEntrypoint, '--workdir', projectRoot, 'status', '--output', 'json'], {
        cwd: projectRoot,
        windowsHide: true,
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: 'true' },
      });
      status = JSON.parse(stdout);
    } catch (error) {
      const detail = error?.code === 'ENOENT'
        ? 'Supabase CLI was not found.'
        : 'Could not read local Supabase status JSON.';
      throw new AcceptanceError(`${detail} Start the local stack and capture its status JSON with the Supabase CLI, or set SUPABASE_STATUS_JSON.`);
    }
  }

  const credentials = extractStatusCredentials(status);
  assert(credentials.url && credentials.anonKey && credentials.serviceRoleKey,
    'Status JSON must contain the local API URL, anon/publishable key, and service-role/secret key.');

  let parsedUrl;
  try {
    parsedUrl = new URL(credentials.url);
  } catch {
    throw new AcceptanceError('Status JSON contains an invalid local API URL.');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  assert(parsedUrl.protocol === 'http:' && localHosts.has(parsedUrl.hostname),
    'Refusing to run service acceptance against a non-loopback URL.');
  return credentials;
}

function makeClient(url, key, accessToken) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS) }) },
    ...(accessToken ? { accessToken: async () => accessToken } : {}),
  });
}

function expectSuccess(result, action) {
  const code = /^[A-Za-z0-9_-]{1,24}$/.test(result.error?.code ?? '') ? result.error.code : undefined;
  if (result.error) throw new AcceptanceError(`${action} failed${code ? ` (error code ${code})` : ''}`);
  return result.data;
}

function expectDenied(result, action, acceptedStatuses = [400, 401, 403, 404, 413, 415]) {
  const status = Number(result.error?.statusCode ?? result.error?.status);
  assert(result.error && (acceptedStatuses.includes(status) || result.error.code === '42501'),
    `${action} was not rejected by an expected authorization or validation response`);
}

function randomEmail(role) {
  return `supabase-acceptance-${role}-${randomUUID()}@example.test`;
}

async function waitForSubscription(channel, label) {
  return withTimeout(new Promise((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') resolve(status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        reject(new AcceptanceError(`${label} Realtime subscription ended with ${status}`));
      }
    });
  }), REALTIME_TIMEOUT_MS, `${label} Realtime subscription`);
}

async function run() {
  const { url, anonKey, serviceRoleKey } = await getLocalCredentials();
  const admin = makeClient(url, serviceRoleKey);
  const anonymous = makeClient(url, anonKey);
  const suffix = randomUUID();
  const roles = ['owner', 'viewer', 'outsider'];
  const users = new Map();
  const channels = [];
  const uploadedObjects = [];
  let organizationId;
  let projectId;
  let failure;

  const step = (message) => console.log(`✓ ${message}`);
  const createUser = async (role) => {
    const email = randomEmail(role);
    const { data, error } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
    const code = /^[A-Za-z0-9_-]{1,24}$/.test(error?.code ?? '') ? error.code : undefined;
    if (error || !data.user) throw new AcceptanceError(`Could not create temporary ${role} Auth user${code ? ` (error code ${code})` : ''}`);
    const client = makeClient(url, anonKey);
    users.set(role, { id: data.user.id, email, client });
    const signedIn = expectSuccess(await client.auth.signInWithPassword({ email, password: TEST_PASSWORD }), `Sign in ${role}`);
    Object.assign(users.get(role), { token: signedIn.session.access_token });
    return users.get(role);
  };

  try {
    const owner = await createUser('owner');
    const viewer = await createUser('viewer');
    const outsider = await createUser('outsider');
    step('temporary owner, viewer, and outsider can authenticate');

    const organization = expectSuccess(await owner.client.from('organizations')
      .insert({ name: `Service acceptance ${suffix}`, slug: `acceptance-${suffix}`, created_by: owner.id })
      .select('id').single(), 'Create temporary organization');
    organizationId = organization.id;
    const project = expectSuccess(await owner.client.from('projects')
      .insert({ organization_id: organizationId, name: `Acceptance ${suffix}`, created_by: owner.id })
      .select('id').single(), 'Create temporary project');
    projectId = project.id;

    expectSuccess(await owner.client.from('organization_members')
      .insert({ organization_id: organizationId, user_id: viewer.id, role: 'member' }), 'Add viewer to temporary organization');
    expectSuccess(await owner.client.from('project_members')
      .insert({ project_id: projectId, user_id: viewer.id, role: 'viewer' }), 'Add viewer to temporary project');

    const inviteToken = randomBytes(32).toString('base64url');
    const inviteHash = createHash('sha256').update(inviteToken).digest('hex');
    const invitation = expectSuccess(await owner.client.from('team_invitations').insert({
      organization_id: organizationId, project_id: projectId, email: viewer.email,
      organization_role: 'member', project_role: 'editor', token_hash: inviteHash,
      invited_by: owner.id, expires_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
    }).select('id').single(), 'Create a scoped team invitation');
    const acceptedInvitation = expectSuccess(await viewer.client.rpc('accept_team_invitation', { target_token_hash: inviteHash }), 'Accept a matching verified-email team invitation');
    assert(acceptedInvitation.length === 1 && acceptedInvitation[0].project_id === projectId, 'Invitation scope was not accepted');
    const acceptedMember = expectSuccess(await admin.from('project_members').select('role')
      .eq('project_id', projectId).eq('user_id', viewer.id).single(), 'Verify invited project role');
    assert(acceptedMember.role === 'editor', 'Team invitation did not grant the intended project role');
    expectDenied(await viewer.client.rpc('accept_team_invitation', { target_token_hash: inviteHash }), 'Reusing an accepted team invitation');
    const savedInvitation = expectSuccess(await admin.from('team_invitations').select('accepted_at')
      .eq('id', invitation.id).single(), 'Verify one-time invitation acceptance');
    assert(Boolean(savedInvitation.accepted_at), 'Invitation was not marked accepted');
    step('team invitations enforce verified email, intended scope, and one-time use');

    const ownProject = expectSuccess(await owner.client.from('projects').select('id').eq('id', projectId).single(), 'Owner reads own project');
    assert(ownProject.id === projectId, 'Owner did not read the created project');
    const viewerProject = expectSuccess(await viewer.client.from('projects').select('id').eq('id', projectId).single(), 'Viewer reads shared project');
    assert(viewerProject.id === projectId, 'Viewer did not read shared project');
    const hiddenProject = expectSuccess(await outsider.client.from('projects').select('id').eq('id', projectId), 'Outsider project query');
    assert(hiddenProject.length === 0, 'Outsider can see another organization project');
    step('project reads are tenant-scoped for owner, viewer, and outsider');

    const generationRequestId = randomUUID();
    const generationPrompt = `Local generation acceptance ${suffix}`;
    const generation = expectSuccess(await owner.client.rpc('create_generation_job', {
      target_project: projectId, request_key: generationRequestId, generation_prompt: generationPrompt,
    }), 'Create a budgeted local generation job');
    assert(generation.length === 1 && generation[0].job_status === 'queued' && generation[0].was_reused === false,
      'Generation was not durably queued before provider dispatch');
    const replay = expectSuccess(await owner.client.rpc('create_generation_job', {
      target_project: projectId, request_key: generationRequestId, generation_prompt: ` ${generationPrompt} `,
    }), 'Retry an idempotent local generation job');
    assert(replay.length === 1 && replay[0].job_id === generation[0].job_id && replay[0].was_reused === true,
      'Generation idempotent retry did not reuse the queued job');
    const hiddenGeneration = expectSuccess(await outsider.client.from('generation_jobs').select('id,status')
      .eq('id', generation[0].job_id), 'Outsider generation lookup');
    assert(hiddenGeneration.length === 0, 'Outsider can read another member’s generation job');
    expectSuccess(await owner.client.rpc('cancel_generation_job', { target_job: generation[0].job_id }), 'Cancel queued generation without provider dispatch');
    const cancelledGeneration = expectSuccess(await admin.from('generation_jobs').select('status,reservation_micro_usd,charged_micro_usd')
      .eq('id', generation[0].job_id).single(), 'Verify queued generation cancellation');
    assert(cancelledGeneration.status === 'cancelled' && cancelledGeneration.reservation_micro_usd === 0
      && cancelledGeneration.charged_micro_usd === 0, 'Pre-dispatch cancellation did not release the budget reservation');
    step('generation RPC persists idempotent queued work and cancels it without provider calls');

    const avatarBucket = expectSuccess(await admin.storage.getBucket('avatars'), 'Read avatar bucket settings');
    assert(avatarBucket.public === false, 'avatars bucket must be private');
    assert(avatarBucket.file_size_limit === 5 * 1024 * 1024, 'avatars bucket must enforce the 5 MiB limit');
    assert(Array.isArray(avatarBucket.allowed_mime_types) && ['image/jpeg', 'image/png', 'image/webp'].every((type) => avatarBucket.allowed_mime_types.includes(type)),
      'avatars bucket MIME allow-list is incomplete');

    const avatarPath = `avatars/${owner.id}/acceptance-${suffix}.png`;
    expectSuccess(await owner.client.storage.from('avatars').upload(avatarPath, new Uint8Array([137, 80, 78, 71]), {
      contentType: 'image/png', upsert: false,
    }), 'Owner uploads own avatar');
    uploadedObjects.push({ client: owner.client, bucket: 'avatars', path: avatarPath });
    expectSuccess(await owner.client.storage.from('avatars').download(avatarPath), 'Owner downloads own avatar');
    expectDenied(await viewer.client.storage.from('avatars').download(avatarPath), 'Viewer downloading owner avatar');
    expectDenied(await anonymous.storage.from('avatars').download(avatarPath), 'Anonymous downloading private avatar');
    const avatarPublicUrl = owner.client.storage.from('avatars').getPublicUrl(avatarPath).data.publicUrl;
    const avatarPublicResponse = await fetch(avatarPublicUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    assert(!avatarPublicResponse.ok, 'Private avatar was accessible through the public object endpoint');
    const viewerAvatarPath = `avatars/${viewer.id}/acceptance-${suffix}.png`;
    expectSuccess(await viewer.client.storage.from('avatars').upload(viewerAvatarPath, new Uint8Array([137, 80, 78, 71]), {
      contentType: 'image/png', upsert: false,
    }), 'Viewer uploads own avatar');
    uploadedObjects.push({ client: viewer.client, bucket: 'avatars', path: viewerAvatarPath });
    expectDenied(await owner.client.storage.from('avatars').upload(`avatars/${owner.id}/invalid-${suffix}.txt`, 'not an image', {
      contentType: 'text/plain', upsert: false,
    }), 'Upload of disallowed avatar MIME type');
    expectDenied(await owner.client.storage.from('avatars').upload(`avatars/${owner.id}/oversize-${suffix}.png`, new Uint8Array(5 * 1024 * 1024 + 1), {
      contentType: 'image/png', upsert: false,
    }), 'Oversized avatar upload');
    expectDenied(await outsider.client.storage.from('avatars').upload(`avatars/${owner.id}/foreign-${suffix}.png`, new Uint8Array([1]), {
      contentType: 'image/png', upsert: false,
    }), 'Outsider uploading into owner avatar path');
    step('private avatar ownership, anonymity, MIME allow-list, and size limit are enforced');

    const mediaBucket = expectSuccess(await admin.storage.getBucket('project-media'), 'Read project media bucket settings');
    assert(mediaBucket.public === false, 'project-media bucket must be private');
    assert(mediaBucket.file_size_limit === 50 * 1024 * 1024, 'project-media bucket must enforce the 50 MiB limit');
    const mediaBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=', 'base64');
    const mediaHash = createHash('sha256').update(mediaBytes).digest('hex');
    const mediaRequestKey = randomUUID();
    const bypassPath = `projects/${projectId}/${randomUUID()}/sample.png`;
    expectDenied(await owner.client.storage.from('project-media').upload(bypassPath, mediaBytes, {
      contentType: 'image/png', upsert: false,
    }), 'Owner cannot bypass upload intent quota through direct Storage writes');
    const intent = expectSuccess(await owner.client.rpc('begin_media_upload', {
      target_project: projectId, request_key: mediaRequestKey, content_hash: mediaHash,
      content_type: 'image/png', upload_name: 'sample.png', upload_size: mediaBytes.byteLength,
    }), 'Create an authenticated media upload intent');
    assert(intent.length === 1 && intent[0].outcome === 'upload' && typeof intent[0].lease_token === 'string',
      'Media upload did not reserve an authenticated intent lease');
    const mediaPath = intent[0].object_path;
    const signedUpload = expectSuccess(await admin.storage.from('project-media').createSignedUploadUrl(mediaPath), 'Create a signed upload capability');
    const persistedCapability = expectSuccess(await admin.rpc('store_media_upload_token', {
      target_intent: intent[0].intent_id, token: intent[0].lease_token, signed_token: signedUpload.token,
    }), 'Persist the signed upload token before returning the capability');
    assert(persistedCapability.length === 1 && persistedCapability[0].upload_token === signedUpload.token
      && Date.parse(persistedCapability[0].expires_at) > Date.now()
      && Date.parse(persistedCapability[0].expires_at) <= Date.now() + 2 * 60 * 60 * 1000 + 30_000,
    'Signed upload capability was not durably stored with its bounded expiry');
    expectSuccess(await owner.client.storage.from('project-media').uploadToSignedUrl(mediaPath, signedUpload.token, mediaBytes, {
      contentType: 'image/png',
    }), 'Upload project media using the persisted signed capability');
    uploadedObjects.push({ client: admin, bucket: 'project-media', path: mediaPath });
    const mediaAssetId = expectSuccess(await admin.rpc('finish_media_upload', {
      target_intent: intent[0].intent_id, token: intent[0].lease_token,
      actual_hash: mediaHash, actual_size: mediaBytes.byteLength,
    }), 'Finalize and convert the upload quota reservation to an asset');
    assert(typeof mediaAssetId === 'string', 'Upload finalization did not create an asset');
    expectSuccess(await viewer.client.storage.from('project-media').download(mediaPath), 'Viewer reads project media');
    expectDenied(await viewer.client.storage.from('project-media').upload(`projects/${projectId}/${randomUUID()}/viewer.png`, new Uint8Array([1]), {
      contentType: 'image/png', upsert: false,
    }), 'Viewer uploading project media');
    expectDenied(await outsider.client.storage.from('project-media').download(mediaPath), 'Outsider downloading project media');
    expectDenied(await outsider.client.storage.from('project-media').upload(`projects/${projectId}/${randomUUID()}/outsider.png`, new Uint8Array([1]), {
      contentType: 'image/png', upsert: false,
    }), 'Outsider uploading project media');
    expectDenied(await owner.client.storage.from('project-media').upload(`projects/${projectId}/${randomUUID()}/invalid.txt`, 'text', {
      contentType: 'text/plain', upsert: false,
    }), 'Upload of disallowed project media MIME type');
    const mediaPublicUrl = owner.client.storage.from('project-media').getPublicUrl(mediaPath).data.publicUrl;
    const mediaPublicResponse = await fetch(mediaPublicUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    assert(!mediaPublicResponse.ok, 'Private project media was accessible through the public object endpoint');
    step('private project media allows participant reads and requires trusted, quota-reserved server writes');

    const receivedByOwner = [];
    const receivedByViewer = [];
    const receivedByOutsider = [];
    const ownerChannel = owner.client.channel(`acceptance-owner-${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${projectId}` }, (payload) => receivedByOwner.push(payload.new));
    const viewerChannel = viewer.client.channel(`acceptance-viewer-${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${projectId}` }, (payload) => receivedByViewer.push(payload.new));
    const outsiderChannel = outsider.client.channel(`acceptance-outsider-${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${projectId}` }, (payload) => receivedByOutsider.push(payload.new));
    channels.push(ownerChannel, viewerChannel, outsiderChannel);
    await Promise.all([waitForSubscription(ownerChannel, 'Owner'), waitForSubscription(viewerChannel, 'Viewer'), waitForSubscription(outsiderChannel, 'Outsider')]);
    expectDenied(await viewer.client.from('messages').insert({
      project_id: projectId, sender_id: viewer.id, body: `Realtime acceptance ${suffix}`,
    }).select('id').single(), 'Viewer inserts a message without commenter permission');
    expectSuccess(await owner.client.from('messages').insert({
      project_id: projectId, sender_id: owner.id, body: `Realtime acceptance ${suffix}`,
    }).select('id').single(), 'Owner inserts project message');

    await withTimeout(new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        if (receivedByOwner.length) return resolve();
        if (Date.now() - started >= REALTIME_TIMEOUT_MS) return reject(new AcceptanceError('Owner did not receive the project message over Realtime'));
        setTimeout(poll, 50);
      };
      poll();
    }), REALTIME_TIMEOUT_MS + 250, 'Owner Realtime event');
    await withTimeout(new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        if (receivedByViewer.length) return resolve();
        if (Date.now() - started >= REALTIME_TIMEOUT_MS) return reject(new AcceptanceError('Viewer did not receive the project message over Realtime'));
        setTimeout(poll, 50);
      };
      poll();
    }), REALTIME_TIMEOUT_MS + 250, 'Viewer Realtime event');
    await new Promise((resolve) => setTimeout(resolve, REALTIME_DENIAL_WINDOW_MS));
    assert(receivedByOwner.some((row) => row.project_id === projectId), 'Owner Realtime event did not match the temporary project');
    assert(receivedByViewer.some((row) => row.project_id === projectId), 'Viewer Realtime event did not match the temporary project');
    assert(receivedByOutsider.length === 0, 'Outsider received a Realtime message from another tenant');
    step('Realtime delivers project messages to a member and withholds them from an outsider');
  } catch (error) {
    failure = error;
  } finally {
    await Promise.allSettled(channels.map((channel) => channel.unsubscribe()));
    for (const object of uploadedObjects) {
      try {
        const { error } = await object.client.storage.from(object.bucket).remove([object.path]);
        if (error) throw error;
      } catch {
        try {
          const { error } = await admin.storage.from(object.bucket).remove([object.path]);
          if (error) throw error;
        } catch {
          if (!failure) failure = new AcceptanceError(`Cleanup could not remove one temporary ${object.bucket} object`);
        }
      }
    }
    if (projectId) {
      try {
        const { error } = await admin.from('projects').delete().eq('id', projectId);
        if (error) throw error;
      } catch {
        if (!failure) failure = new AcceptanceError('Cleanup could not delete the temporary project');
      }
    }
    if (organizationId) {
      try {
        const { error } = await admin.from('organizations').delete().eq('id', organizationId);
        if (error) throw error;
      } catch {
        if (!failure) failure = new AcceptanceError('Cleanup could not delete the temporary organization');
      }
    }
    for (const { id } of users.values()) {
      try {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw error;
      } catch {
        if (!failure) failure = new AcceptanceError('Cleanup could not delete a temporary Auth user');
      }
    }
  }

  if (failure) throw failure;
  console.log('Supabase local Auth/Storage/Realtime acceptance passed.');
}

run().catch((error) => {
  const detail = error instanceof AcceptanceError ? error.message : 'unexpected error; sensitive response details were suppressed';
  console.error(`Supabase local service acceptance failed: ${detail}`);
  process.exitCode = 1;
});
