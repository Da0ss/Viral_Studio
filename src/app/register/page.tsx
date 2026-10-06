import Link from 'next/link';
import type { Route } from 'next';
import { register } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const loginHref = params.next ? `/login?${new URLSearchParams({ next: params.next })}` : '/login';
  return <main className="page auth-page"><section><small>VIRAL / STUDIO</small><h1>РЕГИСТРАЦИЯ</h1><p className="subtitle">Создайте защищённый аккаунт для своей команды.</p><AuthForm action={register} submitLabel="Создать аккаунт" mode="register" next={params.next} /><p className="auth-links">Уже есть аккаунт? <Link href={loginHref as Route}>Войти</Link></p></section></main>;
}
