import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  falSubmit: vi.fn(), falPoll: vi.fn(), falCancel: vi.fn(),
  submit: vi.fn(), poll: vi.fn(), cancel: vi.fn(), download: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/fal-video', () => ({
  submitFalVideo: mocks.falSubmit, pollFalVideo: mocks.falPoll, cancelFalVideo: mocks.falCancel,
  falConfigured: () => Boolean(process.env.FAL_KEY?.trim()),
  isFalModelKey: (value: string) => ['ltx', 'minimax', 'kling', 'seedance'].includes(value),
}));
vi.mock('@/lib/huggingface-video', () => ({
  VIDEO_MODEL: 'legacy-model', VIDEO_PROVIDER: 'legacy-provider',
  submitVideo: mocks.submit, pollVideo: mocks.poll, cancelVideo: mocks.cancel, downloadVideo: mocks.download,
}));

import { adapterFor, multimodelEnabled } from '@/lib/video-providers';

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); });

it('multimodelEnabled only accepts the exact string true', () => {
  vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'true');
  expect(multimodelEnabled()).toBe(true);
  for (const value of ['', 'TRUE', '1', 'false']) {
    vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', value);
    expect(multimodelEnabled()).toBe(false);
  }
});

it.each([
  [undefined, undefined], [null, null], ['', ''], ['legacy-provider', 'ltx'], ['legacy-provider', null],
  ['fal', null], ['fal', undefined], ['fal', 'wan'], ['fal', '__proto__'], ['other', 'ltx'],
])('returns no adapter for %j / %j', (provider, model) => {
  expect(adapterFor(provider, model)).toBeNull();
});

it('legacy adapter is always submittable regardless of flags and delegates to the HF helpers', async () => {
  vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'false'); vi.stubEnv('FAL_KEY', '');
  const adapter = adapterFor('legacy-provider', 'legacy-model')!;
  expect(adapter.submitAvailable()).toBe(true);
  mocks.submit.mockResolvedValue('/legacy/path');
  await expect(adapter.submit('prompt text', 123, 'job-1')).resolves.toEqual({ requestPath: '/legacy/path' });
  expect(mocks.submit).toHaveBeenCalledWith('prompt text', 123);
  expect(adapter.poll).toBe(mocks.poll);
  expect(adapter.cancel).toBe(mocks.cancel);
  expect(adapter.download).toBe(mocks.download);
});

it.each([
  ['true', 'key', true], ['true', '  ', false], ['true', '', false], ['false', 'key', false], ['', 'key', false],
])('fal submitAvailable with flag=%j key=%j is %s', (flag, key, expected) => {
  vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', flag); vi.stubEnv('FAL_KEY', key);
  expect(adapterFor('fal', 'minimax')!.submitAvailable()).toBe(expected);
});

it('fal adapter binds the model key into every provider call', async () => {
  const adapter = adapterFor('fal', 'minimax')!;
  mocks.falSubmit.mockResolvedValue({ requestPath: '/fal-ai/minimax/requests/r1', requestId: 'r1' });
  await expect(adapter.submit('p', 5, 'job-9')).resolves.toEqual({ requestPath: '/fal-ai/minimax/requests/r1', requestId: 'r1' });
  expect(mocks.falSubmit).toHaveBeenCalledWith('minimax', 'p', 5, 'job-9');
  mocks.falPoll.mockResolvedValue({ status: 'pending' });
  await adapter.poll('/fal-ai/minimax/requests/r1', 7);
  expect(mocks.falPoll).toHaveBeenCalledWith('minimax', '/fal-ai/minimax/requests/r1', 7);
  await adapter.cancel('/fal-ai/minimax/requests/r1', 8);
  expect(mocks.falCancel).toHaveBeenCalledWith('minimax', '/fal-ai/minimax/requests/r1', 8);
  expect(adapter.download).toBe(mocks.download);
});
