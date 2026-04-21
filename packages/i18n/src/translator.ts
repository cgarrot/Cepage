import type { Locale } from './locale.js';
import { en } from './messages/en.js';
import { fr } from './messages/fr.js';

const byLocale = {
  en,
  fr,
} as const;

function get(obj: Record<string, string | Record<string, unknown>>, path: string): string | undefined {
  const parts = path.split('.');
  let cur: string | Record<string, unknown> | undefined = obj as Record<string, unknown>;
  for (const p of parts) {
    if (cur === undefined || typeof cur === 'string') return undefined;
    cur = cur[p] as string | Record<string, unknown> | undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(template: string, params?: Readonly<Record<string, unknown>>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    return v === undefined || v === null ? `{${k}}` : String(v);
  });
}

export type Translator = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export function createTranslator(locale: Locale): Translator {
  const table = byLocale[locale] ?? byLocale.en;
  return (key: string, params?: Readonly<Record<string, unknown>>): string => {
    const raw = get(table as Record<string, string | Record<string, unknown>>, key);
    if (raw !== undefined) return interpolate(raw, params);
    const enRaw = get(byLocale.en as Record<string, string | Record<string, unknown>>, key);
    if (enRaw !== undefined) return interpolate(enRaw, params);
    return key;
  };
}
