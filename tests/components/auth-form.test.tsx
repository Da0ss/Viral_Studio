// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LocaleProvider } from '@/components/locale-provider';
import { AuthForm } from '@/components/auth-form';
import type { AuthState } from '@/lib/auth/types';

afterEach(cleanup);

it.each([
  ['en', 'Password', 'The email or password is incorrect.'],
  ['kk', 'Құпиясөз', 'Email немесе құпиясөз қате.'],
] as const)('renders labels and server action errors in %s', async (locale, passwordLabel, errorText) => {
  const action = async (): Promise<AuthState> => ({ error: 'msg.auth.invalidCredentials' });
  render(<LocaleProvider locale={locale}><AuthForm action={action} submitLabel="Go" mode="login" /></LocaleProvider>);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.invalid' } });
  fireEvent.change(screen.getByLabelText(passwordLabel), { target: { value: 'password123' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Go' }).closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toBe(errorText);
});
