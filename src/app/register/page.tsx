import Link from 'next/link';
import type { Route } from 'next';
import { register } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';
import { getServerTranslator } from '@/lib/i18n/server';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams; const { t } = await getServerTranslator();
  const loginHref = params.next ? `/login?${new URLSearchParams({ next: params.next })}` : '/login';
  return <main className="page auth-page"><section><small>VIRAL / STUDIO</small><h1>{t('auth.register.title')}</h1><p className="subtitle">{t('auth.register.subtitle')}</p><AuthForm action={register} submitLabel={t('auth.register.submit')} mode="register" next={params.next} /><p className="auth-links">{t('auth.haveAccount')} <Link href={loginHref as Route}>{t('auth.login.submit')}</Link></p></section></main>;
}
