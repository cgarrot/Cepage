'use client';

import { type ReactNode, useEffect, useLayoutEffect } from 'react';
import { applyThemeToDocument, useWorkspaceStore } from '@cepage/state';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themeMode = useWorkspaceStore((s) => s.themeMode);
  const themeCepage = useWorkspaceStore((s) => s.themeCepage);

  useLayoutEffect(() => {
    applyThemeToDocument(themeMode, themeCepage);
  }, [themeMode, themeCepage]);

  useEffect(() => {
    if (themeMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyThemeToDocument('system', themeCepage);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [themeMode, themeCepage]);

  return <>{children}</>;
}
