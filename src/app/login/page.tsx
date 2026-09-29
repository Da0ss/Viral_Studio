import Link from 'next/link';
import { login } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const configurationError = params.error === 'configuration';
  return <main className="page auth-page"><section><small>VIRAL / STUDIO</small><h1>ВОЙТИ</h1><p className="subtitle">Продолжайте создавать идеи и управлять проектами.</p>{configurationError && <p className="auth-message error" role="alert">Supabase Auth не настроен. Скопируйте `.env.example` в `.env.local` и добавьте ключи проекта.</p>}<AuthForm action={login} submitLabel="Войти" mode="login" next={params.next} /><p className="auth-links">Нет аккаунта? <Link href="/register">Зарегистрироваться</Link><Link href="/forgot-password">Восстановить пароль</Link></p></section></main>;
}
