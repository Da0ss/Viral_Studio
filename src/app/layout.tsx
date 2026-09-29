import type { Metadata } from 'next';
import '../styles/globals.css';
import { Header } from '@/components/header';

export const metadata: Metadata = {
  title: 'VIRAL / Studio',
  description: 'Пространство для создания вирусного контента',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
