// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GoogleAnalytics } from '@/components/google-analytics';

vi.mock('next/script', () => ({
  default: ({ src, id, children }: { src?: string; id?: string; children?: string }) => (
    <script data-src={src} id={id}>{children}</script>
  ),
}));
afterEach(cleanup);

it('renders nothing without a measurement ID', () => {
  const { container } = render(<GoogleAnalytics measurementId={null} />);
  expect(container.innerHTML).toBe('');
});

it('loads gtag with the configured measurement ID', () => {
  const { container } = render(<GoogleAnalytics measurementId="G-TEST1234" />);
  expect(container.querySelector('[data-src]')?.getAttribute('data-src')).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST1234');
  expect(container.querySelector('#google-analytics')?.textContent).toContain("gtag('config', 'G-TEST1234')");
});
