import { expect, it } from 'vitest';
import { hasMediaSignature, maxMediaBytes, safeMediaFilename, validateMediaMetadata, type MediaMime } from '@/lib/media-file';
it('enforces exact size boundaries and explicit MIME allowlist', () => {
  expect(validateMediaMetadata(maxMediaBytes, 'video/mp4')).toBeNull();
  for (const size of [0, -1, NaN, 1.5, maxMediaBytes + 1]) expect(validateMediaMetadata(size, 'video/mp4')).toBeTruthy();
  for (const mime of ['text/html', 'image/svg+xml', 'image/*', '__proto__', 'video/MP4']) expect(validateMediaMetadata(1, mime)).toBeTruthy();
});
it.each<[MediaMime, number[]]>([
  ['image/jpeg', [255,216,255]],
  ['image/png', [137,80,78,71,13,10,26,10]],
  ['image/webp', [82,73,70,70,0,0,0,0,87,69,66,80]],
  ['audio/wav', [82,73,70,70,0,0,0,0,87,65,86,69]],
  ['video/mp4', [0,0,0,20,102,116,121,112,105,115,111,109]],
  ['video/webm', [26,69,223,163]],
  ['audio/mpeg', [73,68,51]],
  ['application/pdf', [37,80,68,70,45]],
])('recognizes %s headers and rejects unrelated or empty bytes', (mime, bytes) => {
  expect(hasMediaSignature(new Uint8Array(bytes), mime)).toBe(true);
  expect(hasMediaSignature(new Uint8Array(), mime)).toBe(false);
  expect(hasMediaSignature(new TextEncoder().encode('<html>bad</html>'), mime)).toBe(false);
});
it('does not confuse WAV and WebP RIFF containers', () => {
  expect(hasMediaSignature(new TextEncoder().encode('RIFF0000WAVE'), 'image/webp')).toBe(false);
});
it('generates bounded canonical filenames instead of trusting extensions or paths', () => {
  expect(safeMediaFilename('../../script.html', 'image/png')).toBe('script.png');
  expect(safeMediaFilename('😎.exe', 'video/mp4')).toBe('material.mp4');
  expect(safeMediaFilename('a'.repeat(500), 'audio/mpeg').length).toBe(84);
});
