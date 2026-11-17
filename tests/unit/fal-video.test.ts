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
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

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


// ---- Additional branch coverage ----
const ltxPath = '/fal-ai/ltx-video/requests/req_123';

it('rejects over-long prompts and posts the per-model payload with the key and no redirects', async () => {
  expect(await codeOf(submitFalVideo('ltx', 'x'.repeat(2001)))).toBe('rejected');
  expect(fetchMock).not.toHaveBeenCalled();
  for (const [key, prefix, extra] of [
    ['ltx', '/fal-ai/ltx-video', { negative_prompt: expect.any(String) }],
    ['kling', '/fal-ai/kling-video', { duration: '5', aspect_ratio: '16:9' }],
    ['seedance', '/bytedance/seedance-2.0', { duration: '5', resolution: '720p', generate_audio: true }],
  ] as const) {
    fetchMock.mockResolvedValueOnce(queued(prefix));
    await submitFalVideo(key, 'A slow shot of clouds', Date.now() + 60_000);
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`https://queue.fal.run/${falModels[key].endpoint}`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(init.headers.Authorization).toBe('Key test-key');
    expect(JSON.parse(init.body)).toEqual({ prompt: 'A slow shot of clouds', ...extra });
  }
});

it('treats credentialed, fragment or non-JSON acknowledgements of an accepted submit as uncertain', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const bad = [
    { request_id: 'req_1', response_url: 'https://user:pw@queue.fal.run/fal-ai/ltx-video/requests/req_1' },
    { request_id: 'req_1', response_url: 'https://queue.fal.run/fal-ai/ltx-video/requests/req_1#frag' },
    { request_id: 'req_1', response_url: 'not a url' },
    { request_id: 'req_1', response_url: 42 },
    { request_id: 42 },
    { request_id: 'a'.repeat(101), response_url: 'https://queue.fal.run/fal-ai/ltx-video/requests/x' },
    null,
    'text',
  ];
  for (const body of bad) {
    fetchMock.mockResolvedValueOnce(json(body));
    expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'))).toBe('uncertain');
  }
  fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
  expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'))).toBe('uncertain');
});

it('logs the request id only when it is well-formed', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  fetchMock.mockResolvedValueOnce(json({ request_id: 'req_1' }));
  expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'))).toBe('uncertain');
  expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ jobId: null, requestId: 'req_1' });
  fetchMock.mockResolvedValueOnce(json({ request_id: 'bad id' }));
  await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'));
  expect(warn).toHaveBeenCalledTimes(1);
});

it('maps non-refusal submit statuses to uncertain (only an explicit refusal proves nothing was accepted)', async () => {
  for (const status of [404, 408, 409, 503, 504]) {
    fetchMock.mockResolvedValueOnce(json({}, status));
    expect(await codeOf(submitFalVideo('ltx', 'A slow shot of clouds'))).toBe('uncertain');
  }
});

it('poll, cancel and path validation fail closed for unknown models and missing keys', async () => {
  expect(await codeOf(pollFalVideo('wan', ltxPath))).toBe('invalid_result');
  expect(await codeOf(cancelFalVideo('wan', ltxPath))).toBe('invalid_result');
  expect(await codeOf(cancelFalVideo('ltx', '/evil/requests/x?y'))).toBe('invalid_result');
  expect(() => validateFalRequestPath(42)).toThrow();
  expect(validateFalRequestPath(ltxPath)).toBe(ltxPath);
  vi.stubEnv('FAL_KEY', ' ');
  expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('unconfigured');
  expect(await codeOf(cancelFalVideo('ltx', ltxPath))).toBe('unconfigured');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('pins every catalog prefix: a path under another model is refused for each model', () => {
  for (const [key, model] of Object.entries(falModels)) {
    expect(validateFalRequestPath(`${model.requestPathPrefix}/requests/r1`, key as keyof typeof falModels)).toBeTruthy();
    expect(() => validateFalRequestPath(`${model.requestPathPrefix}x/requests/r1`, key as keyof typeof falModels)).toThrow();
  }
});

it('poll treats IN_QUEUE as pending, 4xx status as invalid_result, 429 as temporary', async () => {
  fetchMock.mockResolvedValueOnce(json({ status: 'IN_QUEUE' }));
  await expect(pollFalVideo('ltx', ltxPath, Date.now() + 60_000)).resolves.toEqual({ status: 'pending' });
  fetchMock.mockResolvedValueOnce(json({}, 404));
  expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('invalid_result');
  fetchMock.mockResolvedValueOnce(json({}, 429));
  expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('temporary');
  fetchMock.mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockResolvedValueOnce(json({}, 429));
  expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('temporary');
  fetchMock.mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockRejectedValueOnce(new Error('network'));
  expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('temporary');
});

it('poll maps 401/403 on status and result fetches to unconfigured so the worker retries instead of charging', async () => {
  for (const status of [401, 403]) {
    fetchMock.mockResolvedValueOnce(json({ detail: 'secret' }, status));
    expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('unconfigured');
    fetchMock.mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockResolvedValueOnce(json({ detail: 'secret' }, status));
    expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('unconfigured');
  }
});

it('poll reads videos[0] and refuses missing, empty or non-object results', async () => {
  fetchMock.mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockResolvedValueOnce(json({ videos: [{ url: 'https://v3.fal.media/b.mp4' }] }));
  await expect(pollFalVideo('ltx', ltxPath)).resolves.toEqual({ status: 'completed', url: 'https://v3.fal.media/b.mp4' });
  for (const result of [{}, { videos: [] }, { video: {} }, { video: { url: 5 } }, null]) {
    fetchMock.mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockResolvedValueOnce(json(result));
    expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('invalid_result');
  }
  fetchMock.mockResolvedValueOnce(json('x')).mockResolvedValueOnce(json({}));
  expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('invalid_result');
  fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
  expect(await codeOf(pollFalVideo('ltx', ltxPath))).toBe('invalid_result');
});

it('cancel maps network failures to temporary', async () => {
  fetchMock.mockRejectedValueOnce(new Error('network'));
  expect(await codeOf(cancelFalVideo('ltx', ltxPath, Date.now() + 60_000))).toBe('temporary');
});
