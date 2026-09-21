"use client";

import { usePathname } from "next/navigation";
import { ROLE_LABELS } from "@/lib/rbac";
import { NotificationHistory, Role } from "@/lib/types";
import NotificationBell from "./NotificationBell";
import LanguageToggle from "./LanguageToggle";
import { useLanguage } from "./LanguageProvider";

const TITLES: Record<string, string> = {
  dashboard: "Overview",
  "passenger-portal": "Passenger Booking & Scheduling",
  "crew-portal": "Driver & Conductor Live Dashboard",
  "sacco-portal": "Operator Dashboard",
  saccos: "Operator Verification",
  matatus: "Fleet Registry",
  enforcement: "Enforcement Operations",
  passengers: "Passenger Feedback & Safety",
  revenue: "Revenue & Fines",
  fines: "Revenue & Fines",
  routes: "Route Corridors",
  activity: "Activity Log",
  users: "Users & Roles",
  "audit-logs": "System Audit Trail",
};

interface ActionNeeded {
  count: number;
  message: string;
  href: string;
}

export default function Header({
  name,
  role,
  token,
  actionNeeded,
  notificationHistory,
  onMenuClick,
}: {
  name: string;
  role: Role;
  token?: string;
  actionNeeded?: ActionNeeded;
  notificationHistory?: NotificationHistory;
  onMenuClick?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const segment = pathname?.split("/")[1] || "dashboard";
  const title = TITLES[segment] || "Mji-Move";
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("");
  const firstName = name.split(" ")[0];

  return (
    <header className="relative h-16 bg-white/95 backdrop-blur border-b border-county-ink/[0.08] flex items-center justify-between px-4 md:px-6 gap-3 sticky top-0 z-20">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="md:hidden -ml-1 h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-county-ink/70 hover:bg-county-ink/5 hover:text-county-ink"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div className="min-w-0">
          <h1 className="text-base md:text-xl font-black text-county-ink tracking-tight truncate">{title}</h1>
          <p className="text-[11px] text-county-ink/40 font-semibold hidden sm:block">{t("header.welcomeBack")}, {firstName}</p>
        </div>
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
        <div className="text-right leading-tight hidden sm:block">
          <div className="text-sm font-bold text-county-ink">{name}</div>
          <div className="text-[10px] font-bold text-county-green tracking-[0.1em] uppercase mt-0.5">
            {ROLE_LABELS[role] || role}
          </div>
        </div>
        <div className="h-10 w-10 rounded-full bg-county-green text-white flex items-center justify-center text-sm font-black shadow-sm ring-2 ring-county-yellow/60">
          {initials}
        </div>
      </div>
    </header>
  );
}
