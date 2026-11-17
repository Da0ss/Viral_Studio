import Link from 'next/link';
import { requestPasswordReset } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';
import { getServerTranslator } from '@/lib/i18n/server';
import { translateMessage } from '@/lib/i18n/messages';

export default async function ForgotPasswordPage({ searchParams }: { searchParams?: Promise<{ sent?: string | string[] }> }) {
  const [{ t, locale }, params] = await Promise.all([getServerTranslator(), searchParams ?? Promise.resolve({} as { sent?: string })]);
  const sent = params.sent === '1';
  return <main className="page auth-page"><section><small>{t('auth.security')}</small><h1>{t('auth.forgot.titleLine1')}<br />{t('auth.forgot.titleLine2')}</h1><p className="subtitle">{t('auth.forgot.subtitle')}</p>{sent && <p className="auth-message success" role="status">{translateMessage(locale, 'msg.auth.resetSent')}</p>}<AuthForm action={requestPasswordReset} submitLabel={t('auth.forgot.submit')} mode="forgot" /><p className="auth-links"><Link href="/login">{t('auth.backToLogin')}</Link></p></section></main>;
}
