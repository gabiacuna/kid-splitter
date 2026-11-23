import { createContext, Fragment, useCallback, useContext, useState, type ReactNode } from 'react';
import { es } from './es';

/**
 * Minimal i18n. The English source string is the key: `t('Log out')`.
 * Placeholders use `{name}`: `t('{n} students', { n: 3 })`.
 * Spanish is the default; English is a per-browser toggle (persisted in localStorage).
 */
export type Lang = 'es' | 'en';
type Vars = Record<string, string | number>;

const STORAGE_KEY = 'lang';
const DICTS: Record<Lang, Record<string, string>> = { es, en: {} };

function readStoredLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

let currentLang: Lang = readStoredLang();
document.documentElement.lang = currentLang;

/** Non-hook translate for plain functions (lib helpers, toasts in callbacks). */
export function translate(text: string, vars?: Vars): string {
  let out = DICTS[currentLang][text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

export const getLang = () => currentLang;
/** BCP-47 locale for Intl / toLocaleString. */
export const getLocale = () => (currentLang === 'es' ? 'es-ES' : 'en-GB');

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: typeof translate;
}

const LanguageContext = createContext<LangCtx>({ lang: currentLang, setLang: () => {}, t: translate });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);

  const setLang = useCallback((l: Lang) => {
    currentLang = l;
    document.documentElement.lang = l;
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* storage unavailable */ }
    setLangState(l);
  }, []);

  // Keyed remount so components that only use `translate()` (no hook) re-render too.
  return (
    <LanguageContext.Provider value={{ lang, setLang, t: translate }}>
      <Fragment key={lang}>{children}</Fragment>
    </LanguageContext.Provider>
  );
}

export const useLang = () => useContext(LanguageContext);
export const useT = () => useContext(LanguageContext).t;
