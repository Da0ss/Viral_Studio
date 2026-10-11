import { beforeEach, expect, it, vi } from 'vitest';
import { GET as getGenerations } from '@/app/api/generations/route';
import { GET as getVersions } from '@/app/api/media/[assetId]/versions/route';

const mocks = vi.hoisted(() => ({
  generations: vi.fn(), versions: vi.fn(),
  statuses: ['queued', 'running', 'completed', 'failed', 'cancelled'],
}));
vi.mock('@/lib/generations', () => ({ getGenerationHistory: mocks.generations, generationStatuses: mocks.statuses }));
vi.mock('@/lib/media', () => ({ getMediaVersions: mocks.versions }));

const assetId = 'abababab-abab-4bab-8bab-abababababab';
const empty = { status: 'empty', authenticated: true, items: [], page: 1, pageSize: 24, total: 0, totalPages: 0 } as const;
const url = (path: string) => new Request(`https://app.test${path}`);
const media = (request: Request, id = assetId) => getVersions(request, { params: Promise.resolve({ assetId: id }) });

beforeEach(() => vi.resetAllMocks());

it('rejects unknown, duplicate and invalid query values before reader access', async () => {
  for (const request of [
    url('/api/generations?wat=1'),
    url('/api/generations?page=1&page=2'),
    url('/api/generations?page=0'),
    url('/api/generations?page=10001'),
    url('/api/generations?projectId=bad'),
    url('/api/generations?status=uncertain'),
  ]) expect((await getGenerations(request)).status).toBe(400);
  for (const request of [
    url('/api/media/id/versions?filter=x'),
    url('/api/media/id/versions?page=1&page=2'),
    url('/api/media/id/versions?page=1.5'),
    url('/api/media/id/versions?page=10001'),
  ]) expect((await media(request)).status).toBe(400);
  expect((await media(url('/api/media/id/versions'), 'bad')).status).toBe(400);
  expect(mocks.generations).not.toHaveBeenCalled();
  expect(mocks.versions).not.toHaveBeenCalled();
});

it('maps unauthenticated readers to no-store 401 responses', async () => {
  mocks.generations.mockResolvedValue({ status: 'unauthenticated' });
  mocks.versions.mockResolvedValue({ status: 'unauthenticated' });
  const responses = [await getGenerations(url('/api/generations')), await media(url('/api/media/asset/versions'))];
  for (const response of responses) {
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  }
});

it('maps auth and query failures to generic no-store 503 responses', async () => {
  mocks.generations.mockResolvedValue({ status: 'error', code: 'auth_error' });
  mocks.versions.mockResolvedValue({ status: 'error', code: 'query_error' });
  const responses = [await getGenerations(url('/api/generations')), await media(url('/api/media/asset/versions'))];
  for (const response of responses) {
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'Temporarily unavailable' });
  }
});

it('returns private no-store success and empty pages without storage paths', async () => {
  mocks.generations.mockResolvedValue({ status: 'success', authenticated: true, items: [{ id: 'aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae', status: 'queued' }], page: 2, pageSize: 24, total: 1, totalPages: 1 });
  mocks.versions.mockResolvedValue({ status: 'success', authenticated: true, items: [{ id: 'acacacac-acac-4cac-8cac-acacacacacac', asset_id: assetId, version_number: 1, mime_type: 'image/png', size_bytes: 128, created_by: '11111111-1111-4111-8111-111111111111', created_at: '2026-10-01T00:00:00Z' }], page: 1, pageSize: 24, total: 1, totalPages: 1 });
  const generationResponse = await getGenerations(url('/api/generations?page=2&projectId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&status=queued'));
  const mediaResponse = await media(url('/api/media/asset/versions?page=1'));
  expect(generationResponse.status).toBe(200);
  expect(generationResponse.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await generationResponse.json()).toMatchObject({ page: 2, total: 1, items: [{ status: 'queued' }] });
  expect(mediaResponse.status).toBe(200);
  expect(mediaResponse.headers.get('Cache-Control')).toBe('private, no-store');
  const mediaBody = await mediaResponse.json();
  expect(mediaBody).toMatchObject({ page: 1, total: 1, items: [{ version_number: 1 }] });
  expect(mocks.generations).toHaveBeenCalledWith({ projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'queued' }, 2);
  expect(mocks.versions).toHaveBeenCalledWith(assetId, 1);
  expect(JSON.stringify(mediaBody)).not.toContain('storage_path');

  mocks.versions.mockResolvedValue(empty);
  const hiddenParentResponse = await media(url('/api/media/asset/versions'));
  expect(hiddenParentResponse.status).toBe(200);
  expect(hiddenParentResponse.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await hiddenParentResponse.json()).toMatchObject({ items: [], total: 0 });
});
