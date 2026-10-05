import { expect, test } from '@playwright/test';
const endpoint = '/api/projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/media';
test('guest upload receives JSON denial, never an HTML login redirect', async ({ request }) => {
  const response = await request.post(endpoint, { maxRedirects: 0, headers: { origin: 'http://127.0.0.1:3001' }, multipart: { file: { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not uploaded') } } });
  expect(response.status()).toBe(401);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(response.headers()['location']).toBeUndefined();
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ error: 'Войдите снова.' });
});
test('foreign-origin guest request is denied without redirect or internal detail', async ({ request }) => {
  const response = await request.post(endpoint, { maxRedirects: 0, headers: { origin: 'https://attacker.invalid' }, multipart: { file: { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not uploaded') } } });
  expect(response.status()).toBe(401);
  expect(response.headers()['location']).toBeUndefined();
  expect(await response.text()).not.toMatch(/SQL|stack|storage_path/i);
});
