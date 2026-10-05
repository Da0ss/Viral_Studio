import { describe, expect, it } from 'vitest';
import { safeInternalPath } from '@/lib/auth/redirect';
import { parseProjectFilters, projectPageQuery } from '@/lib/projects';
import { profileSchema } from '@/types/profile';
import { messageInputSchema } from '@/types/messages';

describe('untrusted input validation', () => {
  it('preserves project filters across pagination', () => {
    const filters = parseProjectFilters({ q: 'Кампания', type: 'ai', status: 'active', organization: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const query = new URLSearchParams(projectPageQuery(filters, 2).slice(1));
    expect(query.get('q')).toBe('Кампания');
    expect(query.get('type')).toBe('ai');
    expect(query.get('status')).toBe('active');
    expect(query.get('organization')).toBe(filters.organization);
    expect(query.get('page')).toBe('2');
  });
  it('permits only internal post-auth redirects', () => {
    expect(safeInternalPath('/projects?status=active')).toBe('/projects?status=active');
    expect(safeInternalPath('//evil.example')).toBe('/create');
    expect(safeInternalPath('/\\evil.example')).toBe('/create');
    expect(safeInternalPath('https://evil.example')).toBe('/create');
  });

  it('normalizes and bounds project filters', () => {
    expect(parseProjectFilters({ q: '  Sprint  ', type: 'ai', status: 'active', page: '999999' })).toMatchObject({ search: 'Sprint', type: 'ai', status: 'active', page: 10000 });
    expect(parseProjectFilters({ type: 'unknown', status: 'removed', organization: 'not-a-uuid', page: '-3' })).toMatchObject({ type: undefined, status: undefined, organization: undefined, page: 1 });
  });

  it('rejects unsafe profile paths and oversized chat messages', () => {
    const profile = profileSchema.safeParse({ name: 'Анна', email: 'anna@example.com', role: 'Дизайнер', language: 'ru', timezone: 'Asia/Qyzylorda', avatar_path: '../private.png', notification_email: true, notification_browser: true, notification_marketing: false });
    expect(profile.success).toBe(false);
    expect(messageInputSchema.safeParse({ projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', body: 'x'.repeat(4001) }).success).toBe(false);
  });
});
