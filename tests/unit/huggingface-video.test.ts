import { afterEach, expect, it, vi } from 'vitest';
import { downloadVideo, pollVideo, submitVideo, validateVideoDownloadUrl, validateVideoRequestPath } from '@/lib/huggingface-video';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const path = '/fal-ai/ltx-video-13b-distilled/requests/test-request';
it.each(['http://127.0.0.1/result.mp4', 'https://fal.media.attacker.test/result', 'https://user:pass@v3.fal.media/result', 'https://storage.googleapis.com/private/result'])('rejects unsafe provider result %s', url => {
  expect(() => validateVideoDownloadUrl(url)).toThrow();
});
it('rejects queue paths for a different or injected endpoint', () => {
  expect(validateVideoRequestPath(path)).toBe(path);
  expect(() => validateVideoRequestPath(`${path}/../../other`)).toThrow();
  expect(() => validateVideoRequestPath('/fal-ai/expensive-model/requests/id')).toThrow();
});
it('submits fixed cheap parameters and returns a persistable request identity', async () => {
  vi.stubEnv('HF_TOKEN', 'hf_test');
  const fetch = vi.fn().mockResolvedValue(Response.json({ request_id: 'test-request', response_url: `https://queue.fal.run${path}` }));
  vi.stubGlobal('fetch', fetch);
  expect(await submitVideo('A small blue bird flying over a lake')).toBe(path);
  const input = fetch.mock.calls[0][1];
  expect(JSON.parse(input.body)).toMatchObject({ resolution: '480p', num_frames: 81, enable_safety_checker: true });
});
it('keeps uncertain submission distinct from a safe rejection', async () => {
  vi.stubEnv('HF_TOKEN', 'hf_test');
  const fetch = vi.fn().mockRejectedValue(new Error('token secret')); vi.stubGlobal('fetch', fetch);
  await expect(submitVideo('A small blue bird flying over a lake')).rejects.toMatchObject({ code: 'uncertain' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('polls the persisted queue identity without submitting a second generation', async () => {
  vi.stubEnv('HF_TOKEN', 'hf_test');
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'IN_PROGRESS' })); vi.stubGlobal('fetch', fetch);
  expect(await pollVideo(path)).toEqual({ status: 'pending' });
  expect(fetch.mock.calls[0][0]).toContain(`${path}/status?_subdomain=queue`);
  expect(fetch.mock.calls[0][1].method).toBeUndefined();
});
it('rejects forged/non-video bytes before Storage persistence', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not a video</html>')));
  await expect(downloadVideo('https://v3.fal.media/output.mp4')).rejects.toMatchObject({ code: 'invalid_result' });
});
it('treats malformed polling JSON as a safe retry, not a new submission', async () => {
  vi.stubEnv('HF_TOKEN', 'hf_test');
  const fetch = vi.fn().mockResolvedValue(new Response('{invalid')); vi.stubGlobal('fetch', fetch);
  await expect(pollVideo(path)).rejects.toMatchObject({ code: 'temporary' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('redacts result-fetch transport failures and permits a safe polling retry', async () => {
  vi.stubEnv('HF_TOKEN', 'hf_test');
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: 'COMPLETED' })).mockRejectedValueOnce(new Error('private transport info'));
  vi.stubGlobal('fetch', fetch);
  await expect(pollVideo(path)).rejects.toMatchObject({ code: 'temporary' });
  expect(fetch).toHaveBeenCalledTimes(2);
});
