export type ThemeMode = 'system' | 'light' | 'dark';

export type ThemeEffectiveMode = 'light' | 'dark';

/**
 * Cépage = grape variety. Each cépage maps to a wine-themed accent palette
 * and a preferred effective mode (cabernet = dark red wine, chardonnay =
 * light white wine). The list is intentionally extensible — adding a new
 * cépage only requires:
 *   1. extending the union below
 *   2. adding an entry to CEPAGE_DEFAULTS
 *   3. adding the matching `html[data-cepage='...']` block in globals.css
 */
export type ThemeCepage = 'cabernet' | 'chardonnay';

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export const THEME_CEPAGES: ThemeCepage[] = ['cabernet', 'chardonnay'];

export const CEPAGE_DEFAULTS: Record<
  ThemeCepage,
  { mode: ThemeEffectiveMode; label: string }
> = {
  cabernet: { mode: 'dark', label: 'Cabernet' },
  chardonnay: { mode: 'light', label: 'Chardonnay' },
};

export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

export const DEFAULT_THEME_CEPAGE: ThemeCepage = 'cabernet';

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && THEME_MODES.includes(v as ThemeMode);
}

export function isThemeCepage(v: unknown): v is ThemeCepage {
  return typeof v === 'string' && THEME_CEPAGES.includes(v as ThemeCepage);
}

/** Cépage that naturally matches a given effective mode. */
export function cepageForEffectiveMode(mode: ThemeEffectiveMode): ThemeCepage {
  return mode === 'dark' ? 'cabernet' : 'chardonnay';
}

/**
 * Resolves the effective light/dark appearance.
 * When `mode === 'system'`, uses `prefersDark` if provided (tests), else `matchMedia`, else `dark` during SSR.
 */
export function resolveEffectiveThemeMode(
  mode: ThemeMode,
  prefersDark?: boolean,
): ThemeEffectiveMode {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';

  if (prefersDark !== undefined) {
    return prefersDark ? 'dark' : 'light';
  }

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemeToDocument(mode: ThemeMode, cepage: ThemeCepage): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const effective = resolveEffectiveThemeMode(mode);

  root.dataset.themeMode = mode;
  root.dataset.cepage = cepage;
  root.dataset.themeEffective = effective;
  root.style.colorScheme = effective;
}
