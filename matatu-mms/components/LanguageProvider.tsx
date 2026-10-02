"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Language, LANGUAGE_STORAGE_KEY, TranslationKey, translate } from "@/lib/i18n";

interface LanguageContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: (key) => translate(key, "en"),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "sw") setLangState(stored);
  }, []);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }, []);

  const t = useCallback((key: TranslationKey) => translate(key, lang), [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
