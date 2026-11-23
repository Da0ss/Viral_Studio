import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

// Creates 73 confirmed test accounts through the Supabase Auth Admin API.
// public.profiles rows come from the on_auth_user_created_profile trigger
// (private.handle_new_auth_user), which reads user_metadata.name. The script only
// inserts a profile itself if that trigger did not. Existing accounts are never
// modified or deleted. New credentials are appended to .seed/test-users.csv (git-ignored).
//
//   pnpm seed:users            create missing test users, then verify
//   pnpm seed:users --dry-run  validate the list locally, no Supabase calls

const EMAIL_DOMAIN = 'example.test';
const OUT_DIR = resolve(process.cwd(), '.seed');
const CSV_PATH = resolve(OUT_DIR, 'test-users.csv');
const AVATAR_BUCKET = 'avatars';
const EXPECTED_COUNT = 73;

const NAMES = [
  'Alex Miller', 'Sophia Williams', 'Max Johnson', 'Oliver Brown', 'Emma Davis',
  'Liam Wilson', 'Ava Taylor', 'Noah Anderson', 'Mia Thomas', 'Ethan Moore',
  'Isabella Martin', 'Lucas Jackson', 'Amelia White', 'Mason Harris', 'Harper Clark',
  'Logan Lewis', 'Evelyn Walker', 'James Hall', 'Charlotte Young', 'Benjamin King',
  'Abigail Wright', 'Henry Scott', 'Emily Green', 'Daniel Baker', 'Ella Adams',
  'Jack Nelson', 'Grace Carter', 'Samuel Mitchell', 'Chloe Roberts', 'Leo Turner',
  'Aruzhan Seitkali', 'Dias Nurlanov', 'Aigerim Bekova', 'Timur Akhmetov', 'Madina Omarova',
  'Arman Zhaksylyk', 'Dana Serikova', 'Yerlan Abenov', 'Kamila Ismailova', 'Sanzhar Kenzhebayev',
  'Alina Petrova', 'Ivan Sokolov', 'Maria Ivanova', 'Artem Kuznetsov', 'Sofia Lebedeva',
  'Nikita Volkov',
  'Crazy Potato', 'Sleepy Cat', 'Banana King', 'Coffee Addict', 'Pixel Panda',
  'Captain Waffle', 'Turbo Snail', 'Lazy Llama', 'Ninja Pickle', 'Disco Penguin',
  'Grumpy Toast', 'Cosmic Noodle', 'Spicy Mango', 'Fluffy Dragon', 'Sneaky Raccoon',
  'Mr Pancake', 'Silent Duck', 'Rocket Hamster', 'Moody Cactus', 'Funky Monkey',
  'Salty Pretzel', 'Dizzy Owl', 'Happy Burrito', 'Wobbly Walrus', 'Chill Broccoli',
  'Lucky Dumpling', 'Shy Avocado',
];

type SeedUser = { name: string; username: string; email: string };
type CreatedRow = SeedUser & { password: string; id: string };
type Outcome = 'created' | 'skipped' | 'failed';

async function loadEnvLocal(): Promise<void> {
  let text: string;
  try { text = await readFile(resolve(process.cwd(), '.env.local'), 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function buildUsers(): SeedUser[] {
  const users = NAMES.map((name) => {
    const username = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    return { name, username, email: `${username}@${EMAIL_DOMAIN}` };
  });
  if (users.length !== EXPECTED_COUNT) throw new Error(`Expected ${EXPECTED_COUNT} users, got ${users.length}`);
  if (new Set(users.map((u) => u.username)).size !== users.length) throw new Error('Duplicate username in seed list');
  for (const u of users) {
    if (u.name.trim().length < 2 || u.name.length > 80) throw new Error(`Name violates profiles_name length: ${u.name}`);
  }
  return users;
}

const PASSWORD_SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_+='];
function generatePassword(length = 16): string {
  const all = PASSWORD_SETS.join('');
  const chars = PASSWORD_SETS.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// Symmetric 5x5 identicon, 200x200 PNG, derived from the username.
function generateAvatar(seed: string): Buffer {
  const hash = createHash('sha256').update(seed).digest();
  const fg = hslToRgb((hash[0] / 255) * 360, 0.55 + (hash[1] / 255) * 0.25, 0.45);
  const bg: [number, number, number] = [242, 242, 245];
  const grid: boolean[][] = [];
  for (let row = 0; row < 5; row++) {
    const cells = [0, 1, 2].map((col) => hash[2 + row * 3 + col] % 2 === 0);
    grid.push([cells[0], cells[1], cells[2], cells[1], cells[0]]);
  }
  const size = 200, margin = 20, cell = 32;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - margin) / cell), gy = Math.floor((y - margin) / cell);
      const on = gx >= 0 && gx < 5 && gy >= 0 && gy < 5 && grid[gy][gx];
      raw.set(on ? fg : bg, rowStart + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function appendCredentials(rows: CreatedRow[]): Promise<void> {
  if (!rows.length) return;
  await mkdir(OUT_DIR, { recursive: true });
  let existing = '';
  try { existing = await readFile(CSV_PATH, 'utf8'); } catch { existing = 'email,name,username,password,user_id\n'; }
  const lines = rows.map((r) => [r.email, r.name, r.username, r.password, r.id].join(','));
  await writeFile(CSV_PATH, existing + lines.join('\n') + '\n', { mode: 0o600 });
}

async function listAllUsers(supabase: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function ensureProfile(supabase: SupabaseClient, user: User, entry: SeedUser): Promise<void> {
  const { data, error } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (error) throw new Error(`profile read failed: ${error.message}`);
  if (data) return;
  const insert = await supabase.from('profiles').insert({ id: user.id, name: entry.name, email: entry.email });
  if (insert.error) throw new Error(`profile insert failed: ${insert.error.message}`);
}

async function attachAvatar(supabase: SupabaseClient, user: User, username: string): Promise<string | null> {
  const path = `avatars/${user.id}/${randomUUID()}-seed-avatar.png`;
  const upload = await supabase.storage.from(AVATAR_BUCKET).upload(path, generateAvatar(username), { contentType: 'image/png', upsert: false });
  if (upload.error) return `avatar upload failed: ${upload.error.message}`;
  const update = await supabase.from('profiles').update({ avatar_path: path }).eq('id', user.id).is('avatar_path', null);
  if (update.error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    return `avatar_path update failed: ${update.error.message}`;
  }
  return null;
}

async function createOne(supabase: SupabaseClient, entry: SeedUser, existing: Map<string, User>, created: CreatedRow[], warnings: string[]): Promise<Outcome> {
  if (existing.has(entry.email)) {
    console.log(`skip ${entry.email} (already exists, left unchanged)`);
    return 'skipped';
  }
  const password = generatePassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email: entry.email,
    password,
    email_confirm: true,
    user_metadata: { name: entry.name, username: entry.username, is_test_user: true },
  });
  if (error || !data.user) {
    console.error(`FAIL ${entry.email}: ${error?.message ?? 'no user returned'}`);
    return 'failed';
  }
  created.push({ ...entry, password, id: data.user.id });
  try {
    await ensureProfile(supabase, data.user, entry);
  } catch (profileError) {
    console.error(`FAIL ${entry.email}: account created, ${(profileError as Error).message}`);
    return 'failed';
  }
  const avatarWarning = await attachAvatar(supabase, data.user, entry.username);
  if (avatarWarning) warnings.push(`${entry.email}: ${avatarWarning}`);
  console.log(`ok   ${entry.email}`);
  return 'created';
}

async function verify(supabase: SupabaseClient, seed: SeedUser[], before: User[]): Promise<boolean> {
  const after = await listAllUsers(supabase);
  const seedEmails = new Set(seed.map((u) => u.email));
  const testUsers = after.filter((u) => u.email && seedEmails.has(u.email.toLowerCase()));
  const marked = testUsers.filter((u) => u.user_metadata?.is_test_user === true);

  const emails = after.map((u) => u.email?.toLowerCase()).filter(Boolean);
  const duplicateEmails = emails.length - new Set(emails).size;
  const usernames = marked.map((u) => u.user_metadata?.username);
  const duplicateUsernames = usernames.length - new Set(usernames).size;

  const ids = testUsers.map((u) => u.id);
  const { data: profiles, error } = await supabase.from('profiles').select('id, name, email, avatar_path').in('id', ids);
  if (error) throw new Error(`profiles verification failed: ${error.message}`);
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const missingProfiles = testUsers.filter((u) => !profileById.has(u.id)).map((u) => u.email);
  const withAvatar = (profiles ?? []).filter((p) => p.avatar_path).length;

  const afterById = new Map(after.map((u) => [u.id, u]));
  const changedOrMissing = before.filter((u) => {
    const now = afterById.get(u.id);
    return !now || now.email !== u.email || JSON.stringify(now.user_metadata) !== JSON.stringify(u.user_metadata);
  }).map((u) => u.email);

  console.log('\nVerification');
  console.log(`  auth.users total:                 ${before.length} before, ${after.length} after`);
  console.log(`  seed accounts in auth.users:      ${testUsers.length} / ${EXPECTED_COUNT} (is_test_user: ${marked.length})`);
  console.log(`  matching rows in public.profiles: ${testUsers.length - missingProfiles.length} (with avatar: ${withAvatar})`);
  console.log(`  duplicate emails:                 ${duplicateEmails}`);
  console.log(`  duplicate usernames:              ${duplicateUsernames}`);
  console.log(`  pre-existing users changed:       ${changedOrMissing.length}`);
  if (missingProfiles.length) console.log(`  missing profiles: ${missingProfiles.join(', ')}`);
  if (changedOrMissing.length) console.log(`  changed users: ${changedOrMissing.join(', ')}`);

  return testUsers.length === EXPECTED_COUNT && !missingProfiles.length && !duplicateEmails && !duplicateUsernames && !changedOrMissing.length;
}

async function main(): Promise<void> {
  const seed = buildUsers();

  if (process.argv.includes('--dry-run')) {
    const dir = resolve(OUT_DIR, 'avatars-preview');
    await mkdir(dir, { recursive: true });
    for (const u of seed) await writeFile(resolve(dir, `${u.username}.png`), generateAvatar(u.username));
    console.log(`Dry run: ${seed.length} unique users, avatar previews in ${dir}`);
    for (const u of seed) console.log(`${u.email.padEnd(40)} ${u.name}`);
    return;
  }

  await loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const before = await listAllUsers(supabase);
  const existing = new Map(before.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]));
  const created: CreatedRow[] = [];
  const warnings: string[] = [];
  const counts: Record<Outcome, number> = { created: 0, skipped: 0, failed: 0 };

  for (const entry of seed) {
    try {
      counts[await createOne(supabase, entry, existing, created, warnings)]++;
    } catch (error) {
      counts.failed++;
      console.error(`FAIL ${entry.email}: ${(error as Error).message}`);
    }
  }
  await appendCredentials(created);

  console.log(`\nCreated ${counts.created}, skipped ${counts.skipped}, failed ${counts.failed}.`);
  if (warnings.length) console.log(`Warnings:\n  ${warnings.join('\n  ')}`);
  if (created.length) console.log(`New credentials appended to ${CSV_PATH}`);

  const ok = await verify(supabase, seed, before);
  console.log(ok ? '\nAll checks passed.' : '\nSome checks failed, see above.');
  if (!ok || counts.failed) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
