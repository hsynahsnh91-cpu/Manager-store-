import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { ar, type TranslationKey } from './ar';
import { en } from './en';
import type { Language } from '../types';

const dicts = { ar, en };

interface I18nContextValue {
  lang: Language;
  dir: 'rtl' | 'ltr';
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const t = useCallback(
    (key: TranslationKey): string => dicts[lang][key] ?? ar[key] ?? key,
    [lang],
  );
  const value = useMemo<I18nContextValue>(
    () => ({ lang, dir: lang === 'ar' ? 'rtl' : 'ltr', t }),
    [lang, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
