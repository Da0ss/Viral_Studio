import { expect, it } from 'vitest';
import { safeError } from '@/lib/generation-errors';

it.each([
  ['Daily budget exhausted for org', 'msg.generation.budgetExhausted'],
  ['Personal daily generation limit reached', 'msg.generation.personalLimit'],
  ['media quota exceeded', 'msg.generation.quota'],
  ['Generation model unavailable', 'msg.generation.modelUnavailable'],
  ['forbidden', 'msg.generation.forbidden'],
  ['permission denied 42501', 'msg.generation.forbidden'],
  ['Idempotency key conflict', 'msg.generation.keyConflict'],
  ['', 'msg.generation.queueFailed'],
  ['connect ECONNREFUSED 10.0.0.5', 'msg.generation.queueFailed'],
])('maps %j to %s', (message, code) => {
  expect(safeError(message)).toBe(code);
});

it('never echoes raw error text', () => {
  expect(safeError('secret-token-abc relation "x" does not exist')).toBe('msg.generation.queueFailed');
});

it('prefers the budget message when several markers are present', () => {
  expect(safeError('budget exhausted forbidden')).toBe('msg.generation.budgetExhausted');
});
