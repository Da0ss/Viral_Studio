export function detectClientSecrets(content, values = []) {
  const findings = new Set();
  for (const { name, value } of values) {
    if (value.length >= 12 && [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)].some(candidate => content.includes(candidate))) findings.add(name);
  }
  if (/sb_secret_[a-zA-Z0-9_-]{12,}/.test(content)) findings.add('Supabase secret-key pattern');
  if (/\bhf_[a-zA-Z0-9]{30,}\b/.test(content)) findings.add('Hugging Face token pattern');
  for (const token of content.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g) ?? []) {
    try { if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role === 'service_role') findings.add('service-role JWT'); }
    catch { /* Not a JWT payload. */ }
  }
  return [...findings];
}
