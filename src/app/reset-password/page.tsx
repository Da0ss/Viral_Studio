import { updatePassword } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';

export default function ResetPasswordPage() { return <main className="page auth-page"><section><small>БЕЗОПАСНОСТЬ</small><h1>НОВЫЙ<br />ПАРОЛЬ</h1><p className="subtitle">Используйте не менее восьми символов.</p><AuthForm action={updatePassword} submitLabel="Обновить пароль" mode="reset" /></section></main>; }
