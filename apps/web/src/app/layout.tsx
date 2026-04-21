import type { ReactNode } from 'react';
import '@xyflow/react/dist/style.css';
import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'Cepage',
  description: 'Graph-first multi-agent canvas',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
