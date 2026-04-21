'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { createTranslator, type Locale, type Translator } from '@cepage/i18n';
import { useWorkspaceStore } from '@cepage/state';

type I18nValue = {
  t: Translator;
  locale: Locale;
};

const I18nCtx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useWorkspaceStore((s) => s.locale);
  const t = useMemo(() => createTranslator(locale), [locale]);
  const value = useMemo(() => ({ t, locale }), [t, locale]);

  useEffect(() => {
    document.documentElement.lang = locale === 'fr' ? 'fr' : 'en';
  }, [locale]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nCtx);
  if (!v) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return v;
}
