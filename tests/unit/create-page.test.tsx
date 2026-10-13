import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ organizations: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/projects', () => ({ getOrganizations: mocks.organizations }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/create-video-page', () => ({ default: () => null }));
import CreatePage from '@/app/create/page';
import CreateVideoPage from '@/components/create-video-page';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('Redirect'); });
});

it('sends a user without an organization to onboarding before showing generation', async () => {
  mocks.organizations.mockResolvedValue([]);
  await expect(CreatePage()).rejects.toThrow('Redirect');
  expect(mocks.redirect).toHaveBeenCalledWith('/onboarding');
});

it('keeps the new video generation screen for organization members', async () => {
  mocks.organizations.mockResolvedValue([{ id: 'organization', name: 'Studio', role: 'owner' }]);
  expect((await CreatePage()).type).toBe(CreateVideoPage);
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it('does not mistake a membership lookup failure for an empty membership', async () => {
  mocks.organizations.mockRejectedValue(new Error('Membership unavailable'));
  await expect(CreatePage()).rejects.toThrow('Membership unavailable');
  expect(mocks.redirect).not.toHaveBeenCalled();
});
