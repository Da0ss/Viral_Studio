import { updatePassword } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';
import { getServerTranslator } from '@/lib/i18n/server';

export default async function ResetPasswordPage() { const { t } = await getServerTranslator(); return <main className="page auth-page"><section><small>{t('auth.security')}</small><h1>{t('auth.reset.titleLine1')}<br />{t('auth.reset.titleLine2')}</h1><p className="subtitle">{t('auth.reset.subtitle')}</p><AuthForm action={updatePassword} submitLabel={t('auth.reset.submit')} mode="reset" /></section></main>; }
