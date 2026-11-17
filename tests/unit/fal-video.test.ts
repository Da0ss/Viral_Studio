import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { cancelFalVideo, falModels, pollFalVideo, safeFalMediaUrl, submitFalVideo, validateFalRequestPath } from '@/lib/fal-video';
import { adapterFor } from '@/lib/video-providers';

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const queued = (prefix: string, id = 'req_123') => json({
  request_id: id, response_url: `https://queue.fal.run${prefix}/requests/${id}`,
  status_url: `https://queue.fal.run${prefix}/requests/${id}/status`,
});
const codeOf = async (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code?: string }) => error.code);

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubEnv('FAL_KEY', 'test-key'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// Must stay identical to the seeded rows in private.generation_models (contract-multimodel.md).
it('request path prefixes and endpoints equal the catalog seeds', () => {
  expect(Object.fromEntries(Object.entries(falModels).map(([key, model]) => [key, [model.endpoint, model.requestPathPrefix]]))).toEqual({
    ltx: ['fal-ai/ltx-video', '/fal-ai/ltx-video'],
    minimax: ['fal-ai/minimax/video-01', '/fal-ai/minimax'],
    kling: ['fal-ai/kling-video/v3/standard/text-to-video', '/fal-ai/kling-video'],
    seedance: ['bytedance/seedance-2.0/text-to-video', '/bytedance/seedance-2.0'],
  });
});

it('submits to the model endpoint and returns the durable request path', async () => {
  fetchMock.mockResolvedValue(queued('/fal-ai/minimax'));
  await expect(submitFalVideo('minimax', 'A slow shot of clouds')).resolves.toEqual({
    requestPath: '/fal-ai/minimax/requests/req_123', requestId: 'req_123',
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://queue.fal.run/fal-ai/minimax/video-01');
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: expect.objectContaining({ Authorization: 'Key test-key' }) });
});

it('accepts the seedance owner/app prefix', async () => {
  fetchMock.mockResolvedValue(queued('/bytedance/seedance-2.0'));
  await expect(submitFalVideo('seedance', 'A slow shot of clouds')).resolves.toMatchObject({ requestPath: '/bytedance/seedance-2.0/requests/req_123' });
});

it('rejects without a network call for unknown models, bad prompts and a missing key', async () => {
  expect(await codeOf(submitFalVideo('wan', 'A slow shot of clouds'))).toBe('rejected');
  expect(await codeOf(submitFalVideo('ltx', '   '))).toBe('rejected');
  vi.stubEnv('FAL_KEY', '');
  expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'))).toBe('unconfigured');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('maps submit HTTP failures: explicit rejection vs uncertain', async () => {
  for (const status of [400, 401, 403, 422, 429]) {
    fetchMock.mockResolvedValueOnce(json({ detail: 'secret detail' }, status));
    expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'))).toBe('rejected');
  }
  for (const status of [500, 502]) {
    fetchMock.mockResolvedValueOnce(json({}, status));
    expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'))).toBe('uncertain');
  }
  fetchMock.mockRejectedValueOnce(new Error('network'));
  expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'))).toBe('uncertain');
});

it('treats SSRF-shaped or mismatched acknowledgements as uncertain, never following them', async () => {
  const bad = [
    { request_id: 'req_1', response_url: 'https://evil.example/fal-ai/ltx-video/requests/req_1' },
    { request_id: 'req_1', response_url: 'http://queue.fal.run/fal-ai/ltx-video/requests/req_1' },
    { request_id: 'req_1', response_url: 'https://queue.fal.run/fal-ai/ltx-video/requests/req_1?x=1' },
    { request_id: 'req_1', response_url: 'https://queue.fal.run/fal-ai/minimax/requests/req_1' },
    { request_id: 'req_1', response_url: 'https://queue.fal.run/fal-ai/ltx-video/requests/other' },
    { request_id: 'req 1!', response_url: 'https://queue.fal.run/fal-ai/ltx-video/requests/req_1' },
    { request_id: 'req_1' },
  ];
  for (const body of bad) {
    fetchMock.mockResolvedValueOnce(json(body));
    expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'))).toBe('uncertain');
  }
});

it('logs the request id (no prompt) when an accepted submit cannot be verified', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  fetchMock.mockResolvedValueOnce(json({ request_id: 'req_9', response_url: 'https://queue.fal.run/fal-ai/minimax/requests/req_9' }));
  expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds', undefined, 'job-1'))).toBe('uncertain');
  const line = String(warn.mock.calls[0]?.[0]);
  expect(JSON.parse(line)).toEqual({ event: 'generation.submit_unverified', jobId: 'job-1', model: 'ltx', requestId: 'req_9' });
  expect(line).not.toContain('clouds');
  warn.mockRestore();
});

it('polls: pending, completed with a fal.media url, and failures', async () => {
  const path = '/fal-ai/ltx-video/requests/req_123';
  fetchMock.mockResolvedValueOnce(json({ status: 'IN_PROGRESS' }));
  await expect(pollFalVideo('ltx', path)).resolves.toEqual({ status: 'pending' });
  fetchMock.mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockResolvedValueOnce(json({ video: { url: 'https://v3.fal.media/files/a.mp4' } }));
  await expect(pollFalVideo('ltx', path)).resolves.toEqual({ status: 'completed', url: 'https://v3.fal.media/files/a.mp4' });
  expect(fetchMock.mock.calls[1][0]).toBe('https://queue.fal.run/fal-ai/ltx-video/requests/req_123/status');
  expect(fetchMock.mock.calls[2][0]).toBe('https://queue.fal.run/fal-ai/ltx-video/requests/req_123');
  expect(fetchMock.mock.calls[2][1]).toMatchObject({ redirect: 'error' });

  fetchMock.mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockResolvedValueOnce(json({ videos: [{ url: 'https://evil.example/a.mp4' }] }));
  expect(await codeOf(pollFalVideo('ltx', path))).toBe('invalid_result');
  fetchMock.mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockResolvedValueOnce(json({ detail: 'x' }, 422));
  expect(await codeOf(pollFalVideo('ltx', path))).toBe('rejected');
  fetchMock.mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockResolvedValueOnce(json({}, 503));
  expect(await codeOf(pollFalVideo('ltx', path))).toBe('temporary');
  fetchMock.mockResolvedValueOnce(json({}, 500));
  expect(await codeOf(pollFalVideo('ltx', path))).toBe('temporary');
  fetchMock.mockRejectedValueOnce(new Error('network'));
  expect(await codeOf(pollFalVideo('ltx', path))).toBe('temporary');
  fetchMock.mockResolvedValueOnce(json({ status: 'FAILED' }));
  expect(await codeOf(pollFalVideo('ltx', path))).toBe('invalid_result');
});

it('refuses to fetch malformed or off-model request paths', async () => {
  for (const path of ['https://evil.example/a/requests/x', '/fal-ai/ltx-video/requests/../x', '/fal-ai/../requests/x', '/a/requests/x', '/fal-ai/minimax/requests/x', '/fal-ai/ltx-video/requests/x/status']) {
    expect(await codeOf(pollFalVideo('ltx', path))).toBe('invalid_result');
  }
  expect(() => validateFalRequestPath('/fal-ai/minimax/requests/x', 'ltx')).toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('cancels with PUT and maps failures to temporary', async () => {
  fetchMock.mockResolvedValueOnce(json({ status: 'CANCELLATION_REQUESTED' }, 202));
  await expect(cancelFalVideo('ltx', '/fal-ai/ltx-video/requests/req_123')).resolves.toBeUndefined();
  expect(fetchMock.mock.calls[0][0]).toBe('https://queue.fal.run/fal-ai/ltx-video/requests/req_123/cancel');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', redirect: 'error' });
  fetchMock.mockResolvedValueOnce(json({}, 400));
  expect(await codeOf(cancelFalVideo('ltx', '/fal-ai/ltx-video/requests/req_123'))).toBe('temporary');
});

it('only allows https fal.media style download hosts', () => {
  expect(safeFalMediaUrl('https://v3.fal.media/x.mp4')).toBeTruthy();
  expect(safeFalMediaUrl('http://v3.fal.media/x.mp4')).toBeNull();
  expect(safeFalMediaUrl('https://fal.media.evil.example/x.mp4')).toBeNull();
  expect(safeFalMediaUrl('https://user@fal.media/x.mp4')).toBeNull();
});

it('dispatches adapters by provider and model', () => {
  expect(adapterFor('fal-ai', 'Lightricks/LTX-Video-0.9.7-distilled')).not.toBeNull();
  expect(adapterFor('fal', 'ltx')).not.toBeNull();
  expect(adapterFor('fal', 'sora')).toBeNull();
  expect(adapterFor('fal-ai', 'ltx')).toBeNull();
  expect(adapterFor(null, null)).toBeNull();
  vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'false');
  expect(adapterFor('fal', 'ltx')?.submitAvailable()).toBe(false);
  vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'true');
  expect(adapterFor('fal', 'ltx')?.submitAvailable()).toBe(true);
  vi.stubEnv('FAL_KEY', '');
  expect(adapterFor('fal', 'ltx')?.submitAvailable()).toBe(false);
  expect(adapterFor('fal-ai', 'Lightricks/LTX-Video-0.9.7-distilled')?.submitAvailable()).toBe(true);
});

