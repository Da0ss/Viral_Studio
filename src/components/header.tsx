'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/actions/auth';
import type { StudioRoute } from '@/types/studio';

const navigation: Array<{ href: StudioRoute; label: string }> = [
  { href: '/create', label: 'Создать' },
  { href: '/projects', label: 'Проекты' },
  { href: '/team', label: 'Команда' },
  { href: '/media', label: 'Медиатека' },
];

interface HeaderProps { user: { email?: string | null; name?: string } | null; }

export function Header({ user }: HeaderProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="topbar">
      <Link className="brand" href="/create" aria-label="Viral Studio">
        <b>VIRAL</b><i>/</i><span>Studio</span><em>AI. ЛЮДИ. БОЛЬШЕ<br />ВОЗМОЖНОСТЕЙ.</em>
      </Link>
      <nav className="desktop-nav" aria-label="Основная навигация">
        {navigation.map((item) => <Link key={item.href} className={pathname === item.href ? 'active' : ''} aria-current={pathname === item.href ? 'page' : undefined} href={item.href}>{item.label}</Link>)}
      </nav>
      <div className="account">
        <Link className="icon-button" href="/projects" aria-label="Перейти к поиску проектов"><i className="icon ph ph-magnifying-glass" /></Link>
        {user && <Link className="icon-button" href={'/notifications' as Route} aria-label="Открыть уведомления"><i className="icon ph ph-bell" /></Link>}
        <span className="hairline" />
        {user ? <><Link href="/profile" className="avatar black" aria-label="Открыть профиль">{(user.name || user.email)?.charAt(0).toUpperCase() || 'П'}</Link><Link className="person" href="/profile"><b>{user.name || user.email?.split('@')[0] || 'Профиль'}</b><small>{user.email || 'Авторизован'}</small></Link><form action={logout}><button className="auth-logout" type="submit">Выйти</button></form></> : <Link className="auth-login" href="/login">Войти</Link>}
        <button className="mobile-menu" type="button" onClick={() => setMobileMenuOpen((value) => !value)} aria-label="Открыть меню" aria-expanded={isMobileMenuOpen}><i className={`icon ph ph-${isMobileMenuOpen ? 'x' : 'list'}`} /></button>
      </div>
      <nav className={`mobile-nav ${isMobileMenuOpen ? 'open' : ''}`} aria-label="Мобильная навигация">
        {navigation.map((item) => <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>{item.label}</Link>)}
        {user ? <><Link href="/profile" onClick={() => setMobileMenuOpen(false)}>Профиль</Link><form action={logout}><button className="mobile-logout" type="submit">Выйти</button></form></> : <Link href="/login" onClick={() => setMobileMenuOpen(false)}>Войти</Link>}
      </nav>
    </header>
  );
}
