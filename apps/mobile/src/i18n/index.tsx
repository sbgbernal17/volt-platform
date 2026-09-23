/**
 * Internacionalización propia (ADR 0005): español por defecto e inglés disponible; el idioma se toma
 * del dispositivo la primera vez y se recuerda. `t(clave, {x})` interpola `{x}`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { en } from './en.ts';
import { es, type MessageKey } from './es.ts';

export type Locale = 'es' | 'en';
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

export function deviceLocale(): Locale {
  try {
    return getLocales()[0]?.languageCode?.toLowerCase() === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  td: (key: string) => string;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({
  children,
  onChange,
}: {
  children: ReactNode;
  /** Se invoca al cambiar el idioma (la app lo guarda también en el perfil del conductor). */
  onChange?: ((locale: Locale) => void) | undefined;
}) {
  const [locale, setLocaleState] = useState<Locale>(deviceLocale);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'es' || stored === 'en') setLocaleState(stored);
      })
      .catch(() => undefined);
  }, []);
  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
      onChange?.(next);
    },
    [onChange],
  );
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
  const state = useContext(I18nContext);
  if (!state) throw new Error('useI18n fuera de I18nProvider');
  return state;
}
