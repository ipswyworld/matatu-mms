"use client";

import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions";
import { ROLE_LABELS } from "@/lib/rbac";
import { Role } from "@/lib/types";
import NotificationBell from "./NotificationBell";

const TITLES: Record<string, string> = {
  dashboard: "Overview",
  "passenger-portal": "Passenger Booking & Scheduling",
  "crew-portal": "Driver & Conductor Live Dashboard",
  "sacco-portal": "Sacco Dashboard",
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

export default function Header({ name, role, token }: { name: string; role: Role; token?: string }) {
  const pathname = usePathname();
  const segment = pathname?.split("/")[1] || "dashboard";
  const title = TITLES[segment] || "Matatu Management System";
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("");
  const firstName = name.split(" ")[0];

  return (
    <header className="relative h-16 bg-white/95 backdrop-blur border-b border-county-ink/[0.08] flex items-center justify-between px-6 sticky top-0 z-20">
      <div>
        <h1 className="text-lg md:text-xl font-black text-county-ink tracking-tight">{title}</h1>
        <p className="text-[11px] text-county-ink/40 font-semibold hidden sm:block">Welcome back, {firstName}</p>
      </div>

      <div className="flex items-center gap-3">
        {token && <NotificationBell token={token} />}
        <div className="text-right leading-tight hidden sm:block">
          <div className="text-sm font-bold text-county-ink">{name}</div>
          <div className="text-[10px] font-bold text-county-green tracking-[0.1em] uppercase mt-0.5">
            {ROLE_LABELS[role] || role}
          </div>
        </div>
        <div className="h-10 w-10 rounded-full bg-county-green text-white flex items-center justify-center text-sm font-black shadow-sm ring-2 ring-county-yellow/60">
          {initials}
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn-secondary !px-3 !py-2 text-xs">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
