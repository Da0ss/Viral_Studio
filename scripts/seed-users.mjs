import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';

// Creates 73 test accounts through Supabase Auth Admin. The profile row is created
// by the on_auth_user_created_profile trigger; this script then attaches a generated
// avatar. Credentials go to .seed/test-users.csv, which is git-ignored.
//
//   pnpm seed:users            create missing users (safe to re-run)
//   pnpm seed:users --dry-run  validate the list and write avatars to .seed/ only
//   pnpm seed:users --delete   remove every seeded test user and its avatar

const EMAIL_DOMAIN = 'example.test';
const OUT_DIR = resolve(process.cwd(), '.seed');
const CSV_PATH = resolve(OUT_DIR, 'test-users.csv');
const AVATAR_BUCKET = 'avatars';

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
  'Crazy Potato', 'Sleepy Cat', 'Banana King', 'Pixel Panda', 'Captain Waffle',
  'Turbo Snail', 'Lazy Llama', 'Ninja Pickle', 'Disco Penguin', 'Grumpy Toast',
  'Cosmic Noodle', 'Spicy Mango', 'Fluffy Dragon', 'Sneaky Raccoon', 'Mr Pancake',
  'Silent Duck', 'Rocket Hamster', 'Moody Cactus', 'Jelly Bean', 'Funky Monkey',
  'Salty Pretzel', 'Dizzy Owl', 'Happy Burrito', 'Wobbly Walrus', 'Chill Broccoli',
  'Lucky Dumpling', 'Shy Avocado',
];
const EXPECTED_COUNT = 73;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const DELETE = args.has('--delete');

function loadEnvLocal() {
  return readFile(resolve(process.cwd(), '.env.local'), 'utf8').then((text) => {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }).catch(() => {});
}

function buildUsers() {
  const users = NAMES.map((name) => {
    const username = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    return { name, username, email: `${username}@${EMAIL_DOMAIN}` };
  });
  if (users.length !== EXPECTED_COUNT) throw new Error(`Expected ${EXPECTED_COUNT} users, got ${users.length}`);
  const seen = new Set();
  for (const user of users) {
    if (seen.has(user.username)) throw new Error(`Duplicate username: ${user.username}`);
    seen.add(user.username);
  }
  return users;
}

const PASSWORD_SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_+='];
function generatePassword(length = 16) {
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
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// Symmetric 5x5 identicon, 200x200 PNG, derived from the username.
function generateAvatar(seed) {
  const hash = createHash('sha256').update(seed).digest();
  const fg = hslToRgb(hash[0] / 255 * 360, 0.55 + hash[1] / 255 * 0.25, 0.45);
  const bg = [242, 242, 245];
  const grid = [];
  for (let row = 0; row < 5; row++) {
    const cells = [];
    for (let col = 0; col < 3; col++) cells.push(hash[2 + row * 3 + col] % 2 === 0);
    grid.push([cells[0], cells[1], cells[2], cells[1], cells[0]]);
  }
  const size = 200, margin = 20, cell = 32;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - margin) / cell), gy = Math.floor((y - margin) / cell);
      const on = gx >= 0 && gx < 5 && gy >= 0 && gy < 5 && grid[gy][gx];
      const color = on ? fg : bg;
      raw.set(color, rowStart + 1 + x * 3);
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

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
async function readSavedPasswords() {
  try {
    const lines = (await readFile(CSV_PATH, 'utf8')).trim().split('\n').slice(1);
    const map = new Map();
    for (const line of lines) {
      const [email, , , password] = line.split(',');
      if (email && password) map.set(email, password);
    }
    return map;
  } catch {
    return new Map();
  }
}
async function writeCsv(rows) {
  await mkdir(OUT_DIR, { recursive: true });
  const header = 'email,name,username,password,user_id';
  const body = rows.map((r) => [r.email, r.name, r.username, r.password, r.id].map(csvEscape).join(','));
  await writeFile(CSV_PATH, [header, ...body].join('\n') + '\n', { mode: 0o600 });
}

async function listAllUsers(supabase) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

function isSeededUser(user) {
  return user.email?.endsWith(`@${EMAIL_DOMAIN}`) && user.user_metadata?.is_test_user === true;
}

async function attachAvatar(supabase, user, username) {
  const { data: profile, error } = await supabase.from('profiles').select('avatar_path').eq('id', user.id).maybeSingle();
  if (error) throw new Error(`profile read failed: ${error.message}`);
  if (!profile) throw new Error('profile row missing (is the on_auth_user_created_profile trigger applied?)');
  if (profile.avatar_path) return 'kept';
  const path = `avatars/${user.id}/${randomUUID()}-seed-avatar.png`;
  const upload = await supabase.storage.from(AVATAR_BUCKET).upload(path, generateAvatar(username), { contentType: 'image/png', upsert: false });
  if (upload.error) throw new Error(`avatar upload failed: ${upload.error.message}`);
  const update = await supabase.from('profiles').update({ avatar_path: path }).eq('id', user.id);
  if (update.error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    throw new Error(`avatar_path update failed: ${update.error.message}`);
  }
  return 'uploaded';
}

async function seed(supabase, users) {
  const saved = await readSavedPasswords();
  const existing = new Map((await listAllUsers(supabase)).map((u) => [u.email?.toLowerCase(), u]));
  const rows = [];
  let created = 0, kept = 0, reset = 0, failed = 0;

  for (const entry of users) {
    try {
      let authUser = existing.get(entry.email);
      let password = saved.get(entry.email);
      if (!authUser) {
        password = generatePassword();
        const { data, error } = await supabase.auth.admin.createUser({
          email: entry.email,
          password,
          email_confirm: true,
          user_metadata: { name: entry.name, username: entry.username, is_test_user: true },
        });
        if (error) throw new Error(error.message);
        authUser = data.user;
        created++;
      } else if (!isSeededUser(authUser)) {
        throw new Error('email exists but is not a seeded test user, left untouched');
      } else if (!password) {
        password = generatePassword();
        const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password });
        if (error) throw new Error(`password reset failed: ${error.message}`);
        reset++;
      } else {
        kept++;
      }
      const avatar = await attachAvatar(supabase, authUser, entry.username);
      rows.push({ ...entry, password, id: authUser.id });
      console.log(`ok   ${entry.email}  (avatar ${avatar})`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${entry.email}: ${error.message}`);
    }
  }

  await writeCsv(rows);
  console.log(`\nCreated ${created}, already existed ${kept}, password reset ${reset}, failed ${failed}.`);
  console.log(`Credentials: ${CSV_PATH}`);
  if (failed) process.exitCode = 1;
}

async function removeSeeded(supabase) {
  const targets = (await listAllUsers(supabase)).filter(isSeededUser);
  let removed = 0;
  for (const user of targets) {
    const { data: files } = await supabase.storage.from(AVATAR_BUCKET).list(`avatars/${user.id}`);
    if (files?.length) await supabase.storage.from(AVATAR_BUCKET).remove(files.map((f) => `avatars/${user.id}/${f.name}`));
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) console.error(`FAIL ${user.email}: ${error.message}`);
    else { removed++; console.log(`deleted ${user.email}`); }
  }
  await rm(CSV_PATH, { force: true });
  console.log(`\nDeleted ${removed} of ${targets.length} seeded users.`);
}

async function main() {
  const users = buildUsers();

  if (DRY_RUN) {
    const dir = resolve(OUT_DIR, 'avatars-preview');
    await mkdir(dir, { recursive: true });
    for (const u of users) await writeFile(resolve(dir, `${u.username}.png`), generateAvatar(u.username));
    const passwords = new Set(users.map(() => generatePassword()));
    console.log(`Dry run: ${users.length} unique users, ${passwords.size} unique passwords, avatars in ${dir}`);
    for (const u of users) console.log(`${u.email.padEnd(40)} ${u.name}`);
    return;
  }

  await loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  if (DELETE) await removeSeeded(supabase);
  else await seed(supabase, users);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
