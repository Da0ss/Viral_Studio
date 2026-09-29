import type { ReactNode } from 'react';

interface RouteIntroProps { eyebrow?: string; title: ReactNode; children: ReactNode; }

export function RouteIntro({ eyebrow, title, children }: RouteIntroProps) {
  return <main className="page migration-page"><time className="date" dateTime="2026-09-15">15 сентября 2026</time>{eyebrow && <small>{eyebrow}</small>}<h1>{title}</h1>{children}</main>;
}
