"use client";

import { useLanguage } from "./LanguageProvider";

export default function LanguageToggle({ dark = false }: { dark?: boolean }) {
  const { lang, setLang } = useLanguage();

  const base = "text-[10px] font-extrabold px-2 py-1 rounded-md transition-colors";
  const inactive = dark ? "text-white/50 hover:text-white/80" : "text-county-ink/40 hover:text-county-ink/70";
  const active = dark ? "bg-white/15 text-white" : "bg-county-green/10 text-county-green";

  return (
    <div className={`inline-flex items-center gap-0.5 rounded-lg p-0.5 ${dark ? "bg-white/5" : "bg-black/5"}`} role="group" aria-label="Language">
      <button type="button" onClick={() => setLang("en")} className={`${base} ${lang === "en" ? active : inactive}`}>
        EN
      </button>
      <button type="button" onClick={() => setLang("sw")} className={`${base} ${lang === "sw" ? active : inactive}`}>
        SW
      </button>
    </div>
  );
}
