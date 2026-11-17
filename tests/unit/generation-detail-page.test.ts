import { isValidElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), notFound: vi.fn(), redirect: vi.fn(), signed: vi.fn(), asset: vi.fn(), job: vi.fn(), model: vi.fn(), membership: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/profile', () => ({ getCurrentProfile: async () => ({ language: 'en' }) }));
vi.mock('@/components/generation-status', () => ({ GenerationStatus: () => null }));
vi.mock('@/components/media-download', () => ({ MediaDownload: () => null }));
import GenerationPage from '@/app/generations/[id]/page';

const jobId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';
const goodPath = `projects/${projectId}/44444444-4444-4444-8444-444444444444/video.mp4`;

function table(result: () => unknown, modelResult?: () => unknown) {
  const q: Record<string, unknown> = {};
  q.maybeSingle = async () => result();
  q.select = (cols: string) => { if (cols === 'model' && modelResult) q.maybeSingle = async () => modelResult(); return q; }; q.eq = () => q;
  return q;
}
function setup(over: { status?: string; asset?: unknown; membership?: unknown; model?: string; modelError?: boolean } = {}) {
  mocks.model.mockReturnValue(over.modelError ? { data: null, error: { code: '42501' } } : { data: { model: over.model ?? 'ltx' }, error: null });
  mocks.job.mockReturnValue({ data: { id: jobId, project_id: projectId, status: over.status ?? 'completed', dispatch_state: null, input: { prompt: 'p' }, output: { asset_id: assetId }, created_at: '2026-01-01T00:00:00Z' }, error: null });
  mocks.membership.mockReturnValue({ data: 'membership' in over ? over.membership : { role: 'owner' } });
  mocks.asset.mockReturnValue({ data: 'asset' in over ? over.asset : { project_id: projectId, storage_path: goodPath }, error: null });
  mocks.signed.mockResolvedValue({ data: { signedUrl: 'https://signed.example/v' }, error: null });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) },
    from: (name: string) => table(() => name === 'generation_jobs' ? mocks.job() : name === 'project_members' ? mocks.membership() : name === 'assets' ? mocks.asset() : { data: { name: 'Alpha' } }, () => mocks.model()),
    storage: { from: () => ({ createSignedUrl: mocks.signed }) },
  });
}
function find(node: ReactNode, type: string): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) { for (const child of node) { const hit = find(child, type); if (hit) return hit; } return null; }
  if (!isValidElement(node)) return null;
  const element = node as unknown as { type: unknown; props: { children?: ReactNode } & Record<string, unknown> };
  return element.type === type ? element : find(element.props.children, type);
}
const render = async () => GenerationPage({ params: Promise.resolve({ id: jobId }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.notFound.mockImplementation(() => { throw new Error('NotFound'); });
});

it('signs a 10 minute URL and renders a controlled video for a completed job', async () => {
  setup();
  const video = find(await render(), 'video');
  expect(mocks.signed).toHaveBeenCalledWith(goodPath, 600);
  expect(video?.props.src).toBe('https://signed.example/v');
  expect(video?.props.controls).toBe(true);
});

it('does not sign when the asset belongs to another project', async () => {
  setup({ asset: { project_id: '55555555-5555-4555-8555-555555555555', storage_path: goodPath } });
  expect(find(await render(), 'video')).toBeNull();
  expect(mocks.signed).not.toHaveBeenCalled();
});

it('does not sign a malformed storage path', async () => {
  setup({ asset: { project_id: projectId, storage_path: `projects/${projectId}/../other/video.mp4` } });
  expect(find(await render(), 'video')).toBeNull();
  expect(mocks.signed).not.toHaveBeenCalled();
});

it('does not sign for jobs that are not completed', async () => {
  setup({ status: 'running' });
  await render();
  expect(mocks.signed).not.toHaveBeenCalled();
});

it('returns not found without a project membership', async () => {
  setup({ membership: null });
  await expect(render()).rejects.toThrow('NotFound');
  expect(mocks.signed).not.toHaveBeenCalled();
});

it('still renders a completed legacy job when the model column cannot be read', async () => {
  setup({ modelError: true });
  const page = await render();
  expect(mocks.signed).toHaveBeenCalledWith(goodPath, 600);
  expect(find(page, 'video')).not.toBeNull();
});
