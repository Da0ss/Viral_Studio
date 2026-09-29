import Link from 'next/link';
import { register } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';

export default function RegisterPage() { return <main className="page auth-page"><section><small>VIRAL / STUDIO</small><h1>РЕГИСТРАЦИЯ</h1><p className="subtitle">Создайте защищённый аккаунт для своей команды.</p><AuthForm action={register} submitLabel="Создать аккаунт" mode="register" /><p className="auth-links">Уже есть аккаунт? <Link href="/login">Войти</Link></p></section></main>; }
