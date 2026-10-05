'use client';

import { useActionState } from 'react';
import { createOrganization } from '@/actions/organizations';

export function OrganizationForm() {
  const [state, action, pending] = useActionState(createOrganization, {});
  return <form className="auth-form" action={action}>
    <label>Название организации<input name="name" required minLength={2} maxLength={120} disabled={pending} placeholder="Ваша команда или компания" /></label>
    {state.error && <p className="auth-message error" role="alert">{state.error}</p>}
    <button className="cta" disabled={pending}><span>{pending ? 'Создаём…' : 'Создать организацию'}</span></button>
  </form>;
}
