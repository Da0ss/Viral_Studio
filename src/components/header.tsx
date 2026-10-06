'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/actions/auth';
import type { StudioRoute } from '@/types/studio';
import { useI18n } from '@/components/locale-provider';

const navigation: Array<{ href: StudioRoute; key: 'nav.create' | 'nav.projects' | 'nav.team' | 'nav.media' }> = [
  { href: '/create', key: 'nav.create' }, { href: '/projects', key: 'nav.projects' },
  { href: '/team', key: 'nav.team' }, { href: '/media', key: 'nav.media' },
];

interface HeaderProps { user: { email?: string | null; name?: string } | null; }

export function Header({ user }: HeaderProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="topbar">
      <Link className="brand" href="/create" aria-label="Viral Studio">
        <b>VIRAL</b><i>/</i><span>Studio</span><em>AI. ЛЮДИ. БОЛЬШЕ<br />ВОЗМОЖНОСТЕЙ.</em>
      </Link>
      <nav className="desktop-nav" aria-label={t('nav.main')}>
        {navigation.map((item) => <Link key={item.href} className={pathname === item.href ? 'active' : ''} aria-current={pathname === item.href ? 'page' : undefined} href={item.href}>{t(item.key)}</Link>)}
      </nav>
      <div className="account">
        <Link className="icon-button" href="/projects" aria-label={t('nav.search')}><i className="icon ph ph-magnifying-glass" /></Link>
        {user && <Link className="icon-button" href={'/notifications' as Route} aria-label={t('nav.notifications')}><i className="icon ph ph-bell" /></Link>}
        <span className="hairline" />
        {user ? <><Link href="/profile" className="avatar black" aria-label={t('nav.profile')}>{(user.name || user.email)?.charAt(0).toUpperCase() || 'П'}</Link><Link className="person" href="/profile"><b>{user.name || user.email?.split('@')[0] || t('nav.profileLabel')}</b><small>{user.email || t('nav.authorized')}</small></Link><form action={logout}><button className="auth-logout" type="submit">{t('nav.logout')}</button></form></> : <Link className="auth-login" href="/login">{t('nav.login')}</Link>}
        <button className="mobile-menu" type="button" onClick={() => setMobileMenuOpen((value) => !value)} aria-label={t('nav.openMenu')} aria-expanded={isMobileMenuOpen}><i className={`icon ph ph-${isMobileMenuOpen ? 'x' : 'list'}`} /></button>
      </div>
      <nav className={`mobile-nav ${isMobileMenuOpen ? 'open' : ''}`} aria-label={t('nav.mobile')}>
        {navigation.map((item) => <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>{t(item.key)}</Link>)}
        {user ? <><Link href="/profile" onClick={() => setMobileMenuOpen(false)}>{t('nav.profileLabel')}</Link><form action={logout}><button className="mobile-logout" type="submit">{t('nav.logout')}</button></form></> : <Link href="/login" onClick={() => setMobileMenuOpen(false)}>{t('nav.login')}</Link>}
      </nav>
    </header>
  );
}
