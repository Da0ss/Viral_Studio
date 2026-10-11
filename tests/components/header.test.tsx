// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/locale-provider';
import { Header } from '@/components/header';

vi.mock('next/navigation', () => ({ usePathname: () => '/projects' }));
vi.mock('@/actions/auth', () => ({ logout: vi.fn() }));
afterEach(cleanup);

it('describes the mobile menu action that the button will perform', () => {
  render(<LocaleProvider locale="en"><Header user={null} /></LocaleProvider>);
  const button = screen.getByRole('button', { name: 'Open menu' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(button.getAttribute('aria-controls')).toBe('mobile-nav');
  expect(document.getElementById('mobile-nav')).not.toBeNull();
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded')).toBe('true');
});

it('closes the open mobile menu on Escape and returns focus to the toggle', () => {
  render(<LocaleProvider locale="kk"><Header user={null} /></LocaleProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Мәзірді ашу' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  const button = screen.getByRole('button', { name: 'Мәзірді ашу' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(button);
});
