import { describe, expect, it, vi } from 'vitest';
import { cleanupRetrySeconds, processMediaCleanup, type MediaCleanupPorts } from '@/lib/media-cleanup-worker';

const job = {
  id: '12121212-1212-4212-8212-121212121212',
  projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  leaseToken: '13131313-1313-4313-8313-131313131313',
  bucket: 'project-media',
  path: 'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12121212-1212-4212-8212-121212121212/original.png',
  attempts: 1,
};
function ports() {
  return {
    inspectAndRenew: vi.fn<MediaCleanupPorts['inspectAndRenew']>().mockResolvedValue('ready'),
    remove: vi.fn<MediaCleanupPorts['remove']>().mockResolvedValue({ error: null }),
    complete: vi.fn<MediaCleanupPorts['complete']>().mockResolvedValue(true),
    retry: vi.fn<MediaCleanupPorts['retry']>().mockResolvedValue(true),
  };
}
describe('media cleanup core', () => {
  it('checks references before removal and acknowledges the same lease', async () => {
    const p = ports();
    expect(await processMediaCleanup(job, p)).toBe('completed');
    expect(p.remove).toHaveBeenCalledWith('project-media', job.path);
    expect(p.complete).toHaveBeenCalledWith(job);
    expect(p.inspectAndRenew.mock.invocationCallOrder[0]).toBeLessThan(p.remove.mock.invocationCallOrder[0]);
    expect(p.remove.mock.invocationCallOrder[0]).toBeLessThan(p.complete.mock.invocationCallOrder[0]);
  });
  it.each(['stale', 'referenced'] as const)('never removes %s work', async state => {
    const p = ports(); p.inspectAndRenew.mockResolvedValue(state);
    expect(await processMediaCleanup(job, p)).toBe(state === 'stale' ? 'stale' : 'retry_scheduled');
    expect(p.remove).not.toHaveBeenCalled(); expect(p.complete).not.toHaveBeenCalled();
  });
  it('fails closed on reference query errors', async () => {
    const p = ports(); p.inspectAndRenew.mockRejectedValue(new Error('SQL private detail'));
    expect(await processMediaCleanup(job, p)).toBe('retry_scheduled');
    expect(p.retry).toHaveBeenCalledWith(job, 'verification_failed', 30);
    expect(p.remove).not.toHaveBeenCalled();
  });
  it.each([false, true])('retries Storage returned/thrown errors without storing provider details: %s', async throws => {
    const p = ports();
    if (throws) p.remove.mockRejectedValue(new Error('secret provider trace'));
    else p.remove.mockResolvedValue({ error: { message: 'secret provider trace' } });
    expect(await processMediaCleanup(job, p)).toBe('retry_scheduled');
    expect(p.retry).toHaveBeenCalledWith(job, 'storage_failed', 30);
    expect(p.complete).not.toHaveBeenCalled();
  });
  it('does not claim success when acknowledgement loses its lease', async () => {
    const p = ports(); p.complete.mockResolvedValue(false);
    expect(await processMediaCleanup(job, p)).toBe('stale');
    expect(p.retry).not.toHaveBeenCalled();
  });
  it('leaves uncertain acknowledgement for reclaim', async () => {
    const p = ports(); p.complete.mockRejectedValue(new Error('network'));
    expect(await processMediaCleanup(job, p)).toBe('unconfirmed');
    expect(p.retry).not.toHaveBeenCalled();
  });
  it('reports uncertainty if scheduling retry fails', async () => {
    const p = ports(); p.inspectAndRenew.mockResolvedValue('referenced'); p.retry.mockRejectedValue(new Error('network'));
    expect(await processMediaCleanup(job, p)).toBe('unconfirmed');
  });
  it.each([{ bucket: 'avatars' }, { projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { path: '../private' }, { leaseToken: '' }, { attempts: 0 }])('rejects malformed jobs without side effects: %j', async change => {
    const p = ports();
    expect(await processMediaCleanup({ ...job, ...change }, p)).toBe('invalid');
    expect(p.inspectAndRenew).not.toHaveBeenCalled(); expect(p.remove).not.toHaveBeenCalled();
  });
  it('caps exponential retry delay', () => {
    expect(cleanupRetrySeconds(1)).toBe(30); expect(cleanupRetrySeconds(2)).toBe(60);
    expect(cleanupRetrySeconds(1000)).toBe(3600);
  });
});
