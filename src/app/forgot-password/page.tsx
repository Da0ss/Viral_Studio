import Link from 'next/link';
import { requestPasswordReset } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';
import { getServerTranslator } from '@/lib/i18n/server';

export default async function ForgotPasswordPage() { const { t } = await getServerTranslator(); return <main className="page auth-page"><section><small>{t('auth.security')}</small><h1>{t('auth.forgot.titleLine1')}<br />{t('auth.forgot.titleLine2')}</h1><p className="subtitle">{t('auth.forgot.subtitle')}</p><AuthForm action={requestPasswordReset} submitLabel={t('auth.forgot.submit')} mode="forgot" /><p className="auth-links"><Link href="/login">{t('auth.backToLogin')}</Link></p></section></main>; }
