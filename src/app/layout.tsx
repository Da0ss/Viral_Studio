import type { Metadata } from 'next';
import '../styles/globals.css';
import { Header } from '@/components/header';
import { getCurrentProfile } from '@/lib/profile';
import { getCurrentUser } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'VIRAL / Studio',
  description: 'Пространство для создания вирусного контента',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile(user) : null;
  return (
    <html lang="ru">
      <body>
        <Header user={user ? { email: user.email, name: profile?.name } : null} />
        {children}
      </body>
    </html>
  );
}
