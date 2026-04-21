export type Locale = 'en' | 'fr';

export const DEFAULT_LOCALE: Locale = 'en';

const FR = /^fr\b/i;

export function detectLocaleFromNav(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of langs) {
    if (FR.test(l ?? '')) return 'fr';
  }
  return 'en';
}
