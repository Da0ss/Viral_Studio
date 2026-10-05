import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';
const mocks = vi.hoisted(() => ({ configured: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({
  hasSupabasePublicConfig: mocks.configured,
  getSupabasePublicConfig: () => ({ url: 'https://example.invalid', anonKey: 'test' }),
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.configured.mockReturnValue(true);
  mocks.create.mockReturnValue({ auth: { getClaims: vi.fn().mockResolvedValue({ data: null }) } });
});
it('delegates only the exact worker route to machine authentication', async () => {
  const response = await updateSession(new NextRequest('http://localhost/api/internal/media-cleanup'));
  expect(response.headers.get('x-middleware-next')).toBe('1');
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.configured).not.toHaveBeenCalled();
});
it.each(['/api/internal/media-cleanup/other', '/api/internal/media-cleanup-extra', '/api/projects/test/media'])('retains guest API denial for %s', async path => {
  const response = await updateSession(new NextRequest(`http://localhost${path}`));
  expect(response.status).toBe(401); expect(mocks.create).toHaveBeenCalledTimes(1);
});
