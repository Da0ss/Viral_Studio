import { expect, it } from 'vitest';
import { mediaNavigationUrl, singleQueryValue } from '@/lib/media-navigation';
it('ignores ambiguous repeated query parameters instead of treating them as strings', () => {
  expect(singleQueryValue(['one','two'])).toBe('');
  expect(singleQueryValue(undefined)).toBe('');
  expect(singleQueryValue('one')).toBe('one');
});
it('preserves independent pagination and safely encodes project search', () => {
  const params = new URLSearchParams(mediaNavigationUrl(3, 2, 'Уход & summer').slice(1));
  expect(params.get('page')).toBe('3');
  expect(params.get('projectPage')).toBe('2');
  expect(params.get('projectQuery')).toBe('Уход & summer');
  expect([...params.keys()]).toHaveLength(3);
});
