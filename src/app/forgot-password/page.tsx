import Link from 'next/link';
import { requestPasswordReset } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';

export default function ForgotPasswordPage() { return <main className="page auth-page"><section><small>БЕЗОПАСНОСТЬ</small><h1>ВОССТАНОВИТЬ<br />ПАРОЛЬ</h1><p className="subtitle">Отправим письмо со ссылкой для установки нового пароля.</p><AuthForm action={requestPasswordReset} submitLabel="Отправить ссылку" mode="forgot" /><p className="auth-links"><Link href="/login">Вернуться ко входу</Link></p></section></main>; }
