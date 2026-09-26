"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Ticket, MessageSquareWarning, LogOut, type LucideIcon } from "lucide-react";
import { NotificationHistory } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/rbac";
import { logoutAction } from "@/lib/actions";
import { useLanguage } from "./LanguageProvider";
import LanguageToggle from "./LanguageToggle";
import NotificationBell from "./NotificationBell";

interface ActionNeeded {
  count: number;
  message: string;
  href: string;
}

const NAV_ITEMS: { href: string; icon: LucideIcon; labelKey: "nav.passengerPortal" | "nav.feedback" }[] = [
  { href: "/passenger-portal", icon: Ticket, labelKey: "nav.passengerPortal" },
  { href: "/feedback", icon: MessageSquareWarning, labelKey: "nav.feedback" },
];

/**
 * A passenger's entire nav is 2 destinations (book a trip, send feedback) —
 * the persistent-sidebar admin shell that CREW/SACCO_OPERATOR use (AppShell
 * + Sidebar.tsx) is built for real navigation depth and a desk/shift
 * context those roles actually have. Dropping a passenger, who's often on a
 * phone mid-commute, into that same shell is what reads as a repurposed
 * back-office dashboard rather than a transit app. This shell exists only
 * for PASSENGER: a slim top bar plus a bottom tab bar on mobile (the
 * Uber/Bolt/Citymapper pattern), an inline top nav on desktop instead of a
 * drawer, and no collapse/localStorage machinery since there's nothing here
 * worth collapsing.
 */
export default function PassengerShell({
  name,
  token,
  actionNeeded,
  notificationHistory,
  children,
}: {
  name: string;
  token?: string;
  actionNeeded?: ActionNeeded;
  notificationHistory?: NotificationHistory;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const active = "/" + (pathname?.split("/")[1] || "");
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("");
  const firstName = name.split(" ")[0];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur border-b border-county-ink/[0.08] flex items-center justify-between px-4 md:px-6 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-county-cream flex items-center justify-center overflow-hidden">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={36} height={36} className="object-contain" priority />
          </div>
          <div className="leading-tight min-w-0 hidden sm:block">
            <div className="font-black tracking-tight text-county-black text-sm truncate">Nairobi City County</div>
            <div className="text-[9px] font-bold text-county-green tracking-[0.18em] uppercase">Mji-Move</div>
          </div>

          <nav className="hidden md:flex items-center gap-1 ml-4">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                    isActive ? "text-county-green bg-county-green/10" : "text-county-ink/60 hover:text-county-ink hover:bg-county-ink/5"
                  }`}
                >
                  <Icon size={15} strokeWidth={2} />
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <LanguageToggle />
          {token && (
            <NotificationBell
              token={token}
              actionNeeded={actionNeeded}
              initialItems={notificationHistory?.items || []}
              initialUnreadCount={notificationHistory?.unreadCount || 0}
            />
          )}
          <div className="text-right leading-tight hidden lg:block">
            <div className="text-sm font-bold text-county-ink">{firstName}</div>
            <div className="text-[10px] font-bold text-county-green tracking-[0.1em] uppercase mt-0.5">
              {ROLE_LABELS.PASSENGER}
            </div>
          </div>
          <div className="h-9 w-9 rounded-full bg-county-green text-white flex items-center justify-center text-xs font-black shadow-sm ring-2 ring-county-yellow/60">
            {initials}
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              title={t("nav.signOut")}
              aria-label={t("nav.signOut")}
              className="h-9 w-9 rounded-lg flex items-center justify-center text-county-ink/50 hover:bg-county-red/10 hover:text-county-red transition-colors"
            >
              <LogOut size={16} strokeWidth={2} />
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6">{children}</main>

      <footer className="hidden md:flex items-center justify-center gap-3 py-4 text-[11px] font-semibold text-county-ink/40">
        <span>Official County Portal</span>
        <span className="text-county-ink/20">·</span>
        <Link href="/faq" target="_blank" className="hover:text-county-green hover:underline">{t("footer.help")}</Link>
        <span className="text-county-ink/20">·</span>
        <Link href="/terms" target="_blank" className="hover:text-county-green hover:underline">{t("footer.terms")}</Link>
      </footer>

      {/* Bottom tab bar — mobile only. Fixed, so `main` carries pb-24 to
          keep content clear of it. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-county-ink/[0.08] flex items-stretch"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-bold transition-colors ${
                isActive ? "text-county-green" : "text-county-ink/45"
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.4 : 2} />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
