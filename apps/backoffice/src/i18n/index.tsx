/**
 * Internacionalización propia (ADR 0005): textos en archivos de recursos, español por defecto e
 * inglés disponible; el idioma se recuerda en localStorage. `t(clave, {x})` interpola `{x}`.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import type { Locale } from '../lib/format.ts';
import { en } from './en.ts';
import { es, type MessageKey } from './es.ts';

export type { MessageKey };

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { es, en };
const STORAGE_KEY = 'volt.locale';

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = CATALOGS[locale][key] ?? CATALOGS.es[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    params[name] === undefined ? `{${name}}` : String(params[name]),
  );
}

/** Traduce una clave dinámica (p. ej. `status.${estado}`) o devuelve el texto tal cual. */
export function translateDynamic(locale: Locale, key: string): string {
  return key in CATALOGS.es ? translate(locale, key as MessageKey) : key;
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  td: (key: string) => string;
}

const I18nContext = createContext<I18nState | null>(null);

function initialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'es' || stored === 'en') return stored;
    return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // sin almacenamiento: el idioma vive solo en memoria
    }
    document.documentElement.lang = next;
  }, []);
  const value = useMemo<I18nState>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      td: (key) => translateDynamic(locale, key),
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const context = useContext(I18nContext);
  if (!context) throw new Error('I18nProvider ausente');
  return context;
}
