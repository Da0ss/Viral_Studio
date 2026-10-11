import Link from 'next/link';
import type { Route } from 'next';
import { login } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';
import { getServerTranslator } from '@/lib/i18n/server';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams; const { t } = await getServerTranslator();
  const configurationError = params.error === 'configuration';
  const registerHref = params.next ? `/register?${new URLSearchParams({ next: params.next })}` : '/register';
  return <main className="page auth-page"><section><small>VIRAL / STUDIO</small><h1>{t('auth.login.title')}</h1><p className="subtitle">{t('auth.login.subtitle')}</p>{configurationError && <p className="auth-message error" role="alert">{t('auth.configError')}</p>}<AuthForm action={login} submitLabel={t('auth.login.submit')} mode="login" next={params.next} /><p className="auth-links">{t('auth.noAccount')} <Link href={registerHref as Route}>{t('auth.registerLink')}</Link><Link href="/forgot-password">{t('auth.forgotLink')}</Link></p></section></main>;
}
