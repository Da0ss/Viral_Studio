import { beforeEach, expect, it, vi } from 'vitest';
import { runOneMediaCleanup } from '@/lib/media-cleanup-adapter';
const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
const row = {
  id: '12121212-1212-4212-8212-121212121212',
  project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  lease_token: '13131313-1313-4313-8313-131313131313',
  bucket_id: 'project-media', attempts: 1,
  object_path: 'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12121212-1212-4212-8212-121212121212/original.png',
};
function setup() {
  const rpc = vi.fn().mockResolvedValueOnce({ data: [row], error: null })
    .mockResolvedValueOnce({ data: 'ready', error: null })
    .mockResolvedValue({ data: true, error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ remove }));
  mocks.admin.mockReturnValue({ rpc, storage: { from } });
  return { rpc, remove, from };
}
beforeEach(() => vi.resetAllMocks());
it('maps snake-case claims and uses the current token for each RPC', async () => {
  const p = setup(); expect(await runOneMediaCleanup()).toBe('completed');
  expect(mocks.admin).toHaveBeenCalledWith({ requestTimeoutMs: 20_000 });
  expect(p.rpc.mock.calls).toEqual([
    ['claim_media_cleanup'],
    ['inspect_media_cleanup', { job_id: row.id, token: row.lease_token }],
    ['finish_media_cleanup', { job_id: row.id, token: row.lease_token }],
  ]);
  expect(p.from).toHaveBeenCalledWith('project-media');
  expect(p.remove).toHaveBeenCalledWith([row.object_path]);
});
it('does nothing for an empty queue', async () => {
  const p = setup(); p.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  expect(await runOneMediaCleanup()).toBe('empty'); expect(p.from).not.toHaveBeenCalled();
});
it.each([null, {}, { ...row, bucket_id: 'avatars' }])('rejects invalid claimed row %j', async invalid => {
  const p = setup(); p.rpc.mockReset().mockResolvedValue({ data: [invalid], error: null });
  expect(await runOneMediaCleanup()).toBe('invalid'); expect(p.remove).not.toHaveBeenCalled();
  expect(p.rpc).toHaveBeenCalledTimes(1);
});
it.each([false, true])('redacts returned/thrown claim errors: %s', async thrown => {
  const p = setup(); p.rpc.mockReset();
  if (thrown) p.rpc.mockRejectedValue(new Error('SQL secret trace'));
  else p.rpc.mockResolvedValue({ data: null, error: { message: 'SQL secret trace' } });
  await expect(runOneMediaCleanup()).rejects.toThrow('Cleanup claim failed');
  expect(p.remove).not.toHaveBeenCalled();
});
it('fails closed on an unknown inspection result and records only a generic code', async () => {
  const p = setup(); p.rpc.mockReset().mockResolvedValueOnce({ data: [row], error: null })
    .mockResolvedValueOnce({ data: 'unexpected SQL detail', error: null }).mockResolvedValue({ data: true, error: null });
  expect(await runOneMediaCleanup()).toBe('retry_scheduled');
  expect(p.remove).not.toHaveBeenCalled();
  expect(p.rpc).toHaveBeenLastCalledWith('finish_media_cleanup', {
    job_id: row.id, token: row.lease_token, failure: 'verification_failed', delay_seconds: 30,
  });
});
it('does not remove a referenced path', async () => {
  const p = setup(); p.rpc.mockReset().mockResolvedValueOnce({ data: [row], error: null })
    .mockResolvedValueOnce({ data: 'referenced', error: null }).mockResolvedValue({ data: true, error: null });
  expect(await runOneMediaCleanup()).toBe('retry_scheduled'); expect(p.remove).not.toHaveBeenCalled();
  expect(p.rpc.mock.calls[2][1]).toMatchObject({ failure: 'referenced' });
});
it('schedules a retry for Storage errors without provider details', async () => {
  const p = setup(); p.remove.mockResolvedValue({ error: { message: 'provider secret' } });
  expect(await runOneMediaCleanup()).toBe('retry_scheduled');
  expect(p.rpc.mock.calls[2][1]).toMatchObject({ failure: 'storage_failed' });
  expect(JSON.stringify(p.rpc.mock.calls)).not.toContain('provider secret');
});
it('does not treat a malformed completion response as success', async () => {
  const p = setup(); p.rpc.mockReset().mockResolvedValueOnce({ data: [row], error: null })
    .mockResolvedValueOnce({ data: 'ready', error: null }).mockResolvedValue({ data: 'true', error: null });
  expect(await runOneMediaCleanup()).toBe('unconfirmed'); expect(p.rpc).toHaveBeenCalledTimes(3);
});
