import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectClientSecrets } from './lib/client-secrets.mjs';
test('detects literal and encoded secrets without returning their values', () => {
  const value = 'fake-secret/with+characters';
  for (const content of [value, encodeURIComponent(value)]) assert.deepEqual(detectClientSecrets(content, [{ name: 'SERVER_API_KEY', value }]), ['SERVER_API_KEY']);
});
test('detects service role but permits public anonymous JWT', () => {
  const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fakeSignature`;
  assert.deepEqual(detectClientSecrets(jwt('service_role')), ['service-role JWT']);
  assert.deepEqual(detectClientSecrets(jwt('anon')), []);
});
test('detects secret key patterns, not publishable keys', () => {
  assert.deepEqual(detectClientSecrets('sb_secret_fake_only_test_value'), ['Supabase secret-key pattern']);
  assert.deepEqual(detectClientSecrets('sb_publishable_fake_only_test_value'), []);
});
test('detects Hugging Face credentials without exposing values', () => {
  assert.deepEqual(detectClientSecrets('hf_' + 'a'.repeat(34)), ['Hugging Face token pattern']);
  assert.deepEqual(detectClientSecrets('HF_TOKEN=hf_your_token'), []);
});
