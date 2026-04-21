'use client';

import { useEffect, useState } from 'react';
import type { ThemeMode } from '@cepage/state';
import { resolveEffectiveThemeMode } from '@cepage/state';

/**
 * React Flow resolves `colorMode="system"` with `matchMedia`, which disagrees with SSR
 * and causes `react-flow light` vs `react-flow dark` hydration mismatches.
 * Until the tree has mounted, use the same default as `resolveEffectiveThemeMode` when
 * `window` is absent (`system` → `dark`); after mount, follow the real preference.
 */
export function useResolvedFlowColorMode(mode: ThemeMode): 'light' | 'dark' {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    return 'dark';
  }

  return resolveEffectiveThemeMode(mode);
}
