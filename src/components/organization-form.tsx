'use client';

import { useActionState } from 'react';
import { createOrganization } from '@/actions/organizations';
import { useI18n } from '@/components/locale-provider';

export function OrganizationForm() {
  const { t, tm } = useI18n();
  const [state, action, pending] = useActionState(createOrganization, {});
  return <form className="auth-form" action={action}>
    <label>{t('onboarding.orgName')}<input name="name" required minLength={2} maxLength={120} disabled={pending} placeholder={t('onboarding.orgPlaceholder')} /></label>
    {state.error && <p className="auth-message error" role="alert">{tm(state.error)}</p>}
    <button className="cta" disabled={pending}><span>{pending ? t('team.creating') : t('team.createOrganizationButton')}</span></button>
  </form>;
}
