import { beforeEach, expect, it, vi } from 'vitest';
import { runOneMediaUploadReconcile } from '@/lib/media-upload-reconcile-adapter';
const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
const row = { intent_id: '12121212-1212-4212-8212-121212121212', lease_token: '13131313-1313-4313-8313-131313131313', bucket_id: 'project-media', object_path: 'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12121212-1212-4212-8212-121212121212/original.png' };
function setup(removeResult = { error: null }) {
  const rpc = vi.fn().mockResolvedValueOnce({ data: [row], error: null }).mockResolvedValueOnce({ data: true, error: null });
  const remove = vi.fn().mockResolvedValue(removeResult);
  mocks.admin.mockReturnValue({ rpc, storage: { from: vi.fn(() => ({ remove })) } });
  return { rpc, remove };
}
beforeEach(() => vi.resetAllMocks());
it('removes one claimed object and acknowledges its fenced token', async () => {
  const client = setup();
  expect(await runOneMediaUploadReconcile()).toBe('completed');
  expect(client.rpc).toHaveBeenNthCalledWith(1, 'claim_media_upload_cleanup');
  expect(client.remove).toHaveBeenCalledWith([row.object_path]);
  expect(client.rpc).toHaveBeenNthCalledWith(2, 'finish_media_upload_cleanup', { target_intent: row.intent_id, token: row.lease_token, success: true, delay_seconds: 60 });
});
it('retries Storage removal failures without leaking provider details', async () => {
  const client = setup({ error: { message: 'secret provider trace' } });
  expect(await runOneMediaUploadReconcile()).toBe('retry_scheduled');
  expect(client.rpc).toHaveBeenLastCalledWith('finish_media_upload_cleanup', expect.objectContaining({ success: false }));
  expect(JSON.stringify(client.rpc.mock.calls)).not.toContain('secret provider');
});
it('does not acknowledge a lease replaced during Storage removal', async () => {
  const client = setup(); client.rpc.mockReset().mockResolvedValueOnce({ data: [row], error: null }).mockResolvedValueOnce({ data: false, error: null });
  expect(await runOneMediaUploadReconcile()).toBe('stale');
});
it('rejects malformed claims without Storage writes', async () => {
  const client = setup(); client.rpc.mockReset().mockResolvedValue({ data: [{ ...row, object_path: '../private' }], error: null });
  expect(await runOneMediaUploadReconcile()).toBe('invalid'); expect(client.remove).not.toHaveBeenCalled();
});
it('does nothing for an empty queue', async () => {
  const client = setup(); client.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  expect(await runOneMediaUploadReconcile()).toBe('empty'); expect(client.remove).not.toHaveBeenCalled();
});
