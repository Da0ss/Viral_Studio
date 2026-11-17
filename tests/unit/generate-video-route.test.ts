import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: vi.fn(), getUser: vi.fn(), organizations: vi.fn(), rpc: vi.fn(), advance: vi.fn(), after: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/projects', () => ({ getOrganizationsResult: mocks.organizations }));
vi.mock('@/lib/generation-worker', () => ({ advanceGenerationJob: mocks.advance }));
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: mocks.after }));
import { POST } from '@/app/api/generate-video/route';
import { videoModelIds, videoModels } from '@/lib/video-models';

const prompt = 'A calm lake at sunrise with drifting mist';
const projectId = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';
const requestId = '9b2c7d1e-4f3a-4b5c-8d6e-7f8091a2b3c4';
const valid = { prompt, model: 'ltx', projectId, requestId };
const call = (body: unknown, origin: string | null = 'https://app.test') => POST(new Request('https://app.test/api/generate-video', {
  method: 'POST',
  headers: origin ? { Origin: origin, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));
const fetchMock = vi.fn();
const jobRow = { job_id: 'job-1', job_status: 'queued', was_reused: false };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
  vi.stubEnv('GENERATION_ENABLED', 'true');
  vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'true');
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.organizations.mockResolvedValue({ organizations: [{ id: 'org', name: 'Studio', role: 'owner' }], error: null });
  mocks.rpc.mockResolvedValue({ data: [jobRow], error: null });
  mocks.advance.mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('returns 503 before touching auth when generation is disabled', async () => {
  vi.stubEnv('GENERATION_ENABLED', 'false');
  const response = await call(valid);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'msg.generation.disabled' });
  expect(mocks.client).not.toHaveBeenCalled();
});

it('fails closed when the multi-model flag is not enabled', async () => {
  vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', '');
  expect((await call(valid)).status).toBe(503);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('rejects a cross-origin request', async () => {
  expect((await call(valid, 'https://attacker.test')).status).toBe(403);
  expect(mocks.client).not.toHaveBeenCalled();
});

it('returns 401 for an unauthenticated caller', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await call(valid)).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each(['LTX-Video', 'Kling Video (Kuaishou)', '__proto__', '', 42])('rejects unknown model %j with 400', async (model) => {
  const response = await call({ ...valid, model });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'msg.generation.checkInput' });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each([
  ['malformed json', '{nope'],
  ['short prompt', { ...valid, prompt: 'short' }],
  ['long prompt', { ...valid, prompt: 'x'.repeat(2001) }],
  ['extra field', { ...valid, endpoint: 'evil' }],
  ['missing model', { prompt, projectId, requestId }],
  ['missing projectId', { prompt, model: 'ltx', requestId }],
  ['missing requestId', { prompt, model: 'ltx', projectId }],
  ['bad projectId', { ...valid, projectId: 'nope' }],
  ['bad requestId', { ...valid, requestId: 'nope' }],
])('rejects %s with 400', async (_name, body) => {
  expect((await call(body)).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('requires organization membership', async () => {
  mocks.organizations.mockResolvedValue({ organizations: [], error: null });
  expect((await call(valid)).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('returns 503 when membership cannot be checked', async () => {
  mocks.organizations.mockResolvedValue({ organizations: [], error: 'unavailable' });
  expect((await call(valid)).status).toBe(503);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each(['kling', 'seedance'])('rejects unpriced model %s before the RPC', async (model) => {
  const response = await call({ ...valid, model });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'msg.generation.modelUnavailable' });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});

it('enqueues with the user client and returns 202 with the job shape', async () => {
  const response = await call({ ...valid, model: 'minimax' });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ jobId: 'job-1', status: 'queued', reused: false });
  expect(mocks.rpc).toHaveBeenCalledWith('create_generation_job', {
    target_project: projectId, request_key: requestId, generation_prompt: prompt, model_key: 'minimax',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('reports an idempotent reuse', async () => {
  mocks.rpc.mockResolvedValue({ data: [{ job_id: 'job-1', job_status: 'running', was_reused: true }], error: null });
  const response = await call(valid);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ jobId: 'job-1', status: 'running', reused: true });
});

it.each([
  ['budget exhausted', 429, 'msg.generation.budgetExhausted'],
  ['Personal daily generation limit reached', 429, 'msg.generation.personalLimit'],
  ['media quota exceeded', 429, 'msg.generation.quota'],
  ['Generation model unavailable', 400, 'msg.generation.modelUnavailable'],
  ['forbidden', 403, 'msg.generation.forbidden'],
  ['Idempotency key conflict', 409, 'msg.generation.keyConflict'],
  ['connect ECONNREFUSED 10.0.0.5', 502, 'msg.generation.queueFailed'],
])('maps RPC error %j to %s without leaking details', async (message, status, code) => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message, code: 'P0001' } });
  const response = await call(valid);
  const text = await response.text();
  expect(response.status).toBe(status);
  expect(JSON.parse(text)).toEqual({ error: code });
  expect(text).not.toContain('ECONNREFUSED');
  expect(mocks.after).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(prompt);
});

it('returns a generic error when the 4-arg RPC does not exist yet (migration not applied)', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function public.create_generation_job(model_key) in the schema cache', code: 'PGRST202' } });
  const response = await call(valid);
  const text = await response.text();
  expect(response.status).toBe(502);
  expect(JSON.parse(text)).toEqual({ error: 'msg.generation.queueFailed' });
  expect(text).not.toContain('schema cache');
  expect(mocks.after).not.toHaveBeenCalled();
});

it('returns an unconfirmed error when the RPC returns no job', async () => {
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  expect((await call(valid)).status).toBe(502);
  expect(mocks.after).not.toHaveBeenCalled();
});

it('schedules the first advance step via after() and logs failures without the prompt', async () => {
  expect((await call(valid)).status).toBe(202);
  expect(mocks.after).toHaveBeenCalledTimes(1);
  const task = mocks.after.mock.calls[0][0] as () => Promise<void>;
  await task();
  expect(mocks.advance).toHaveBeenCalledWith('job-1', 'user-1');

  mocks.advance.mockRejectedValue(new Error(`boom ${prompt}`));
  await expect(task()).resolves.toBeUndefined();
  const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
  expect(logged).toContain('job-1');
  expect(logged).not.toContain(prompt);
});

it('keeps the allow-list in sync with the registry', () => {
  expect([...videoModelIds].sort()).toEqual(['kling', 'ltx', 'minimax', 'seedance']);
  expect(videoModels.filter((model) => model.priced).map((model) => model.id).sort()).toEqual(['ltx', 'minimax']);
});

// ---- Additional branch coverage ----
it('rejects an oversized body before parsing', async () => {
  const response = await call(JSON.stringify({ ...valid, prompt: 'x'.repeat(9000) }));
  expect(response.status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('returns 401 when auth lookup errors', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: new Error('jwt') });
  expect((await call(valid)).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('returns 403 when the organization lookup reports a non-availability error', async () => {
  mocks.organizations.mockResolvedValue({ organizations: [], error: 'forbidden' });
  expect((await call(valid)).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('fails closed with a generic 503 when the client cannot be created', async () => {
  mocks.client.mockRejectedValue(new Error(`db password ${prompt}`));
  const response = await call(valid);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'msg.generation.queueFailed' });
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(prompt);
  expect(mocks.after).not.toHaveBeenCalled();
});

it('accepts a single-object RPC result and defaults a missing status to queued', async () => {
  mocks.rpc.mockResolvedValue({ data: { job_id: 'job-7', job_status: 5, was_reused: 'yes' }, error: null });
  const response = await call(valid);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ jobId: 'job-7', status: 'queued', reused: false });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

it('returns unconfirmed when the RPC data is null', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  expect((await call(valid)).status).toBe(502);
});

it('maps an RPC error without a code using the message alone', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Idempotency key conflict' } });
  const response = await call(valid);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'msg.generation.keyConflict' });
});

it('maps an RPC 42501 code to forbidden even when the message is opaque', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'denied', code: '42501' } });
  expect((await call(valid)).status).toBe(403);
});

it('rejects a request without a trusted Origin header', async () => {
  expect((await call(valid, null)).status).toBe(403);
  expect(mocks.client).not.toHaveBeenCalled();
});
