"use client";

import Link from "next/link";
import LanguageToggle from "./LanguageToggle";
import { useLanguage } from "./LanguageProvider";

/**
 * Shared footer for every public (unauthenticated) surface — login,
 * register, operator onboarding, pay-fine, FAQ, terms. Keeps the "who are
 * we, where do I get help, what are the legal terms" answer identical
 * everywhere a first-time or logged-out visitor lands.
 */
export default function PublicFooter({
  dark = false,
  topSlot,
}: {
  dark?: boolean;
  /** Replaces the language toggle in the top slot, e.g. when a page already has one elsewhere. */
  topSlot?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const linkClass = dark
    ? "text-white/80 hover:text-county-yellow"
    : "text-county-ink/75 hover:text-county-green";
  const dividerClass = dark ? "text-white/30" : "text-county-ink/25";

  return (
    <footer className={`px-5 py-8 ${dark ? "bg-county-black text-white" : "bg-county-cream"}`}>
      <div className="max-w-5xl mx-auto flex flex-col items-center gap-4 text-center">
        {topSlot ?? <LanguageToggle dark={dark} />}

        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-bold">
          <Link href="/contact" className={`transition-colors ${linkClass}`}>{t("footer.contactUs")}</Link>
          <span className={dividerClass}>·</span>
          <Link href="/faq" className={`transition-colors ${linkClass}`}>{t("footer.help")}</Link>
          <span className={dividerClass}>·</span>
          <Link href="/terms" className={`transition-colors ${linkClass}`}>{t("footer.privacyPolicy")}</Link>
          <span className={dividerClass}>·</span>
          <Link href="/terms" className={`transition-colors ${linkClass}`}>{t("footer.terms")}</Link>
        </nav>

        <p className={`text-[11px] ${dark ? "text-white/55" : "text-county-ink/55"}`}>
          © 2026 Nairobi City County Government. {t("footer.rights")}
        </p>
      </div>
    </footer>
  );
}
