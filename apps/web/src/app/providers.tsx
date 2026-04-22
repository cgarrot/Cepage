'use client';

import type { ReactNode } from 'react';
import { CommandPalette, I18nProvider, ThemeProvider } from '@cepage/app-ui';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        {children}
        <CommandPalette />
      </I18nProvider>
    </ThemeProvider>
  );
}
