// React state and browser integration for localization live separately from the message text so
// feature catalogues remain pure, statically bundled data and callers retain one stable context.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { messages, type I18nKey } from "./catalog";
import type { Lang, LangPreference, MessageCatalog } from "./types";

const STORAGE_KEY = "dopedb.lang";

interface I18nValue {
  lang: Lang;
  langPreference: LangPreference;
  setLang: (preference: LangPreference) => void;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Missing or invalid preferences follow the system; existing explicit choices are preserved. */
export function resolveLangPreference(stored: string | null): LangPreference {
  return stored === "en" || stored === "ko" ? stored : "system";
}

/** Resolves the system locale to one of the two shipped catalogue languages. */
export function resolveInitialLang(stored: string | null, browserLanguage: string): Lang {
  if (stored === "en" || stored === "ko") return stored;
  return browserLanguage.toLowerCase().split("-")[0] === "ko" ? "ko" : "en";
}

/** Keeps the document language and the persisted user preference in one place. */
export function synchronizeLangPreference(
  preference: LangPreference,
  lang: Lang,
  documentElement: Pick<HTMLElement, "lang">,
  storage: Pick<Storage, "setItem">,
) {
  documentElement.lang = lang;
  storage.setItem(STORAGE_KEY, preference);
}

/** Resolves a translated template with Korean-to-English fallback retained for partial data. */
export function resolveMessage(
  catalog: MessageCatalog,
  lang: Lang,
  key: string,
): string | undefined {
  return catalog[lang][key] ?? catalog.en[key];
}

/** Replaces the existing simple `{name}` interpolation tokens without adding an ICU runtime. */
export function formatMessage(
  template: string,
  vars: Record<string, string | number> | undefined,
) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] == null ? `{${key}}` : String(vars[key]),
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [langPreference, setLangState] = useState<LangPreference>(() =>
    resolveLangPreference(localStorage.getItem(STORAGE_KEY)),
  );
  const [systemLanguage, setSystemLanguage] = useState(() => navigator.language);
  const lang = resolveInitialLang(langPreference, systemLanguage);
  const setLang = useCallback((preference: LangPreference) => {
    setSystemLanguage(navigator.language);
    setLangState(preference);
  }, []);

  useEffect(() => {
    const refreshSystemLanguage = () => setSystemLanguage(navigator.language);
    window.addEventListener("languagechange", refreshSystemLanguage);
    window.addEventListener("focus", refreshSystemLanguage);
    return () => {
      window.removeEventListener("languagechange", refreshSystemLanguage);
      window.removeEventListener("focus", refreshSystemLanguage);
    };
  }, []);

  useEffect(() => {
    synchronizeLangPreference(langPreference, lang, document.documentElement, localStorage);
  }, [langPreference, lang]);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      langPreference,
      setLang,
      t: (key, vars) => formatMessage(resolveMessage(messages, lang, key)!, vars),
    }),
    [langPreference, lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
