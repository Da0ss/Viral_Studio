export const maxMediaBytes = 50 * 1024 * 1024;
export const mediaFormats = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'video/webm': { kind: 'video', extension: 'webm' },
  'audio/mpeg': { kind: 'audio', extension: 'mp3' },
  'audio/wav': { kind: 'audio', extension: 'wav' },
  'application/pdf': { kind: 'document', extension: 'pdf' },
} as const;
export type MediaMime = keyof typeof mediaFormats;
export function validateMediaMetadata(size: number, mime: string): string | null {
  if (!Number.isSafeInteger(size) || size <= 0) return 'Выберите непустой файл.';
  if (size > maxMediaBytes) return 'Размер файла не должен превышать 50 МиБ.';
  if (!Object.hasOwn(mediaFormats, mime)) return 'Формат файла не поддерживается.';
  return null;
}
const matches = (bytes: Uint8Array, values: number[], offset = 0) => values.every((value, index) => bytes[offset + index] === value);
const ascii = (bytes: Uint8Array, text: string, offset = 0) => matches(bytes, Array.from(text, char => char.charCodeAt(0)), offset);
// Only an early mismatch detector. A matching header is NOT full decoding,
// malware scanning, proof of media duration, or a safe-inline-content verdict.
export function hasMediaSignature(bytes: Uint8Array, mime: MediaMime): boolean {
  switch (mime) {
    case 'image/jpeg': return matches(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png': return matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp': return ascii(bytes, 'RIFF') && ascii(bytes, 'WEBP', 8);
    case 'audio/wav': return ascii(bytes, 'RIFF') && ascii(bytes, 'WAVE', 8);
    case 'application/pdf': return ascii(bytes, '%PDF-');
    case 'video/webm': return matches(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'video/mp4': return bytes.length >= 12 && ascii(bytes, 'ftyp', 4);
    case 'audio/mpeg': return ascii(bytes, 'ID3') || (bytes.length >= 4 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0 && (bytes[2] & 0xf0) !== 0xf0 && (bytes[2] & 0x0c) !== 0x0c);
  }
}
export function safeMediaFilename(name: string, mime: MediaMime): string {
  const stem = name.normalize('NFKD').replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'material';
  return `${stem}.${mediaFormats[mime].extension}`;
}
