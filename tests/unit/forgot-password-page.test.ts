import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('@/actions/auth', () => ({ requestPasswordReset: vi.fn() }));
vi.mock('@/components/auth-form', () => ({ AuthForm: () => null }));
vi.mock('@/lib/profile', () => ({ getCurrentProfile: async () => ({ language: 'en' }) }));
import ForgotPasswordPage from '@/app/forgot-password/page';

function findStatus(node: ReactNode): { props: { children?: ReactNode } } | null {
  if (Array.isArray(node)) { for (const child of node) { const found = findStatus(child); if (found) return found; } return null; }
  if (!isValidElement(node)) return null;
  const props = node.props as { role?: string; children?: ReactNode };
  if (props.role === 'status') return node as unknown as { props: { children?: ReactNode } };
  return findStatus(props.children);
}

describe('forgot-password page', () => {
  it('renders the success status when sent=1', async () => {
    const status = findStatus(await ForgotPasswordPage({ searchParams: Promise.resolve({ sent: '1' }) }));
    expect(status).not.toBeNull();
    expect(status!.props.children).toBe('If the account exists, a recovery email has been sent.');
  });
  it.each([[{}], [{ sent: '0' }], [{ sent: ['1', '1'] }]])('does not render the status for %j', async (params) => {
    expect(findStatus(await ForgotPasswordPage({ searchParams: Promise.resolve(params) }))).toBeNull();
  });
  it('does not render the status without searchParams', async () => {
    expect(findStatus(await ForgotPasswordPage({}))).toBeNull();
  });
});
