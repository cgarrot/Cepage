'use client';

import type { ReactNode } from 'react';
import { I18nProvider, ThemeProvider } from '@cepage/app-ui';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}
