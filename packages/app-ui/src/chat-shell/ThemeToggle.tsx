'use client';

import { useCallback } from 'react';
import { IconButton, IconLightbulb, IconTheme, Tooltip } from '@cepage/ui-kit';
import { useWorkspaceStore } from '@cepage/state';
import { useI18n } from '../I18nProvider';

/**
 * Compact light/dark switch. Cabernet (red wine) is bound to the dark mode
 * and Chardonnay (white wine) to the light mode through the store, so users
 * only need a single click to swap.
 */
export function ThemeToggle() {
  const { t } = useI18n();
  const themeMode = useWorkspaceStore((s) => s.themeMode);
  const setThemeMode = useWorkspaceStore((s) => s.setThemeMode);

  const isDark = themeMode === 'dark';
  const next = isDark ? 'light' : 'dark';
  const label = isDark
    ? t('ui.chat.themeToLight')
    : t('ui.chat.themeToDark');

  const onToggle = useCallback(() => {
    setThemeMode(next);
  }, [next, setThemeMode]);

  return (
    <Tooltip label={label}>
      <IconButton size={28} label={label} onClick={onToggle}>
        {isDark ? <IconLightbulb size={16} /> : <IconTheme size={16} />}
      </IconButton>
    </Tooltip>
  );
}
