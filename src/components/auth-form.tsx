'use client';

import { useActionState } from 'react';
import { initialAuthState, type AuthState } from '@/lib/auth/types';

type AuthAction = (state: AuthState, formData: FormData) => Promise<AuthState>;

interface AuthFormProps {
  action: AuthAction;
  submitLabel: string;
  mode: 'login' | 'register' | 'forgot' | 'reset';
  next?: string;
}

export function AuthForm({ action, submitLabel, mode, next }: AuthFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialAuthState);
  const needsPassword = mode !== 'forgot';
  return (
    <form className="auth-form" action={formAction}>
      {next && <input type="hidden" name="next" value={next} />}
      {mode !== 'reset' && <label>Email<input name="email" type="email" autoComplete="email" required disabled={isPending} /></label>}
      {needsPassword && <label>{mode === 'reset' ? 'Новый пароль' : 'Пароль'}<input name="password" type="password" minLength={8} autoComplete={mode === 'reset' ? 'new-password' : mode === 'register' ? 'new-password' : 'current-password'} required disabled={isPending} /></label>}
      {state.error && <p className="auth-message error" role="alert">{state.error}</p>}
      {state.success && <p className="auth-message success" role="status">{state.success}</p>}
      <button className="cta" type="submit" disabled={isPending}><span>{isPending ? 'Подождите…' : submitLabel}</span><i className="icon ph ph-arrow-right" /></button>
    </form>
  );
}
