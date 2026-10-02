"use client";

import { useLanguage } from "@/components/LanguageProvider";

export interface DemoAccount {
  role: string;
  email: string;
  password: string;
}

interface DemoAccountsListProps {
  accounts: DemoAccount[];
}

export default function DemoAccountsList({ accounts }: DemoAccountsListProps) {
  const { t } = useLanguage();
  return (
    <details className="rounded-xl border border-county-ink/10 bg-white/60 group">
      <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-county-ink/60">
        <span>{t("login.demoAccounts")}</span>
        <span className="text-county-green group-open:rotate-45 transition-transform text-lg leading-none">+</span>
      </summary>
      <ul className="px-4 pb-4 space-y-1.5 text-xs text-county-ink/70">
        {accounts.map((a) => (
          <li key={a.email} className="flex justify-between gap-2">
            <span className="font-semibold text-county-ink/80">{a.role}</span>
            <span className="font-mono text-[11px]">{a.email} / {a.password}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
