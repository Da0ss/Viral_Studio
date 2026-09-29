'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { StudioRoute } from '@/types/studio';

const navigation: Array<{ href: StudioRoute; label: string }> = [
  { href: '/create', label: 'Создать' },
  { href: '/projects', label: 'Проекты' },
  { href: '/team', label: 'Команда' },
  { href: '/media', label: 'Медиатека' },
];

export function Header() {
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
        <span className="hairline" />
        <Link href="/profile" className="avatar black" aria-label="Профиль Алексея">А</Link>
        <Link className="person" href="/profile"><b>Алексей</b><small>BestBite Co.</small></Link>
        <button className="mobile-menu" type="button" onClick={() => setMobileMenuOpen((value) => !value)} aria-label="Открыть меню" aria-expanded={isMobileMenuOpen}><i className={`icon ph ph-${isMobileMenuOpen ? 'x' : 'list'}`} /></button>
      </div>
      <nav className={`mobile-nav ${isMobileMenuOpen ? 'open' : ''}`} aria-label="Мобильная навигация">
        {navigation.map((item) => <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>{item.label}</Link>)}
        <Link href="/profile" onClick={() => setMobileMenuOpen(false)}>Профиль</Link>
      </nav>
    </header>
  );
}
