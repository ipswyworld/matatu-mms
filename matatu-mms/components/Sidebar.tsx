"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BadgeCheck,
  Bus,
  ShieldAlert,
  MessageSquare,
  Wallet,
  Route as RouteIcon,
  Users,
  Settings,
  ClipboardList,
  FileWarning,
  FolderOpen,
  Gavel,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { Role } from "@/lib/types";
import { Action, canAny } from "@/lib/rbac";
import { useLanguage } from "./LanguageProvider";
import { logoutAction } from "@/lib/actions";

// One icon per destination, keyed by href — a handful of hrefs (e.g.
// /matatus, /enforcement) are shared across several roles' nav lists with
// different labels, so keying by href instead of by label keeps the
// mapping a single source of truth instead of repeating per role.
const NAV_ICONS: Record<string, LucideIcon> = {
  "/matatus": Bus,
  "/revenue": Wallet,
  "/enforcement": ShieldAlert,
  "/activity": ClipboardList,
  "/enforcement/scene": FileWarning,
  "/enforcement/cases": FolderOpen,
  "/enforcement/disputes": Gavel,
  "/dashboard": LayoutDashboard,
  "/saccos/verify": BadgeCheck,
  "/passengers": MessageSquare,
  "/routes": RouteIcon,
  "/users": Users,
  "/system": Settings,
};

const SIDEBAR_COLLAPSED_KEY = "nccg_sidebar_collapsed";

export default function Sidebar({
  role,
  additionalRoles = [],
  mobileOpen = false,
  onClose,
}: {
  role: Role;
  additionalRoles?: Role[];
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const active = "/" + (pathname?.split("/")[1] || "");
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  function toggleSection(section: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

  // This is the staff app (county government back-office) — Passenger,
  // Crew, and Sacco Operator roles sign in through the separate public app
  // and never reach this Sidebar.
  // Section groups the long full-staff list into collapsible headers
  // (SYSTEM_AUDIT.md §6's "sidebar too long" flag) — undefined for the
  // narrower per-role lists below, which stay flat since they're already
  // short (2-6 items) and don't need sectioning.
  type NavItem = { href: string; label: string; action: Action; section?: string };

  const DEFAULT_STAFF_ITEMS: NavItem[] = [
    { href: "/dashboard", label: t("nav.overview"), action: "view_dashboard" },
    { href: "/saccos/verify", label: t("nav.operatorVerification"), action: "verify_saccos", section: "Fleet" },
    { href: "/matatus", label: t("nav.fleetRegistry"), action: "view_matatus", section: "Fleet" },
    { href: "/routes", label: t("nav.routes"), action: "view_routes", section: "Fleet" },
    { href: "/enforcement", label: t("nav.enforcement"), action: "view_enforcement", section: "Enforcement" },
    { href: "/enforcement/disputes", label: "Dispute Reviews", action: "review_case_dispute", section: "Enforcement" },
    { href: "/revenue", label: t("nav.revenueFines"), action: "view_revenue", section: "Revenue" },
    { href: "/passengers", label: t("nav.passengerFeedback"), action: "view_passengers", section: "Revenue" },
    { href: "/users", label: t("nav.users"), action: "view_users", section: "Administration" },
    { href: "/system", label: "System", action: "view_system_health", section: "Administration" },
  ];

  // Per-role nav lists, keyed as data instead of an if/else chain so a
  // user's effective nav can be the UNION of their primary role's list and
  // any additional roles' lists (e.g. an Enforcement Commander who's also
  // been granted an additional ADMIN role sees both sets, deduped by href).
  // A role with no entry here (ADMIN/SUPERADMIN/VIEWER, and any additional
  // role that doesn't need its own narrower list) falls back to the shared
  // full staff list.
  const NAV_ITEMS_BY_ROLE: Partial<Record<Role, NavItem[]>> = {
    ENFORCEMENT: [
      { href: "/enforcement", label: t("nav.overview"), action: "view_enforcement" },
      { href: "/my-duty", label: "My Duty", action: "view_activity" },
      { href: "/matatus", label: "Fleet Lookup", action: "view_matatus" },
      { href: "/activity", label: "My Activity Log", action: "view_activity" },
    ],
    ARRESTING_OFFICER: [
      { href: "/enforcement", label: t("nav.overview"), action: "view_enforcement" },
      { href: "/my-duty", label: "My Duty", action: "view_activity" },
      { href: "/enforcement/scene", label: "Report Offence", action: "file_enforcement_case" },
      { href: "/enforcement/cases", label: "My Cases", action: "view_enforcement_cases" },
      { href: "/matatus", label: "Fleet Lookup", action: "view_matatus" },
      { href: "/activity", label: "My Activity Log", action: "view_activity" },
    ],
    RELEASING_OFFICER: [
      { href: "/enforcement", label: t("nav.overview"), action: "view_enforcement" },
      { href: "/my-duty", label: "My Duty", action: "view_activity" },
      { href: "/enforcement/cases", label: "Case Queue", action: "view_enforcement_cases" },
      { href: "/matatus", label: "Fleet Lookup", action: "view_matatus" },
      { href: "/activity", label: "My Activity Log", action: "view_activity" },
    ],
    ENFORCEMENT_COMMANDER: [
      { href: "/enforcement", label: t("nav.overview"), action: "view_enforcement" },
      { href: "/my-duty", label: "My Duty", action: "view_activity" },
      { href: "/enforcement/cases", label: "Case Queue", action: "view_enforcement_cases" },
      { href: "/enforcement/disputes", label: "Dispute Reviews", action: "review_case_dispute" },
      { href: "/enforcement/scene", label: "Report Offence", action: "file_enforcement_case" },
      { href: "/matatus", label: "Fleet Lookup", action: "view_matatus" },
      { href: "/activity", label: "My Activity Log", action: "view_activity" },
    ],
    DIRECTOR_MOBILITY: [
      { href: "/dashboard", label: t("nav.overview"), action: "view_dashboard" },
      { href: "/saccos/verify", label: t("nav.operatorVerification"), action: "view_operator_verification" },
    ],
    CHIEF_OFFICER: [
      { href: "/dashboard", label: t("nav.overview"), action: "view_dashboard" },
      { href: "/saccos/verify", label: t("nav.operatorVerification"), action: "view_operator_verification" },
    ],
  };

  const effectiveRoles: Role[] = [role, ...additionalRoles];
  const seenHrefs = new Set<string>();
  const unionItems = effectiveRoles
    .flatMap((r) => NAV_ITEMS_BY_ROLE[r] ?? DEFAULT_STAFF_ITEMS)
    .filter((item) => {
      if (seenHrefs.has(item.href)) return false;
      seenHrefs.add(item.href);
      return true;
    });

  const navItems = unionItems.filter((item) => canAny(effectiveRoles, item.action));
  // The icon-only collapsed state is a desktop affordance — the mobile drawer
  // always shows full labels regardless of the persisted desktop preference.
  const effectiveCollapsed = collapsed && !mobileOpen;

  return (
    <>
      {/* Backdrop — mobile drawer only */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed md:sticky inset-y-0 left-0 md:top-0 z-40 md:z-auto shrink-0 bg-county-green-deep text-white h-screen flex flex-col border-r border-black/10 overflow-hidden transition-transform md:transition-[width] duration-200 ease-out w-72 ${
          collapsed ? "md:w-[76px]" : "md:w-64"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
      >
        {/* Sidebar Header — real logo + wordmark on a cream chip so the crest reads correctly */}
        <div className={`flex items-center gap-3 border-b border-white/10 bg-black/10 ${effectiveCollapsed ? "p-4 md:justify-center" : "p-5"}`}>
          <div className="h-11 w-11 shrink-0 rounded-xl bg-county-cream flex items-center justify-center overflow-hidden shadow-md">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={44} height={44} className="object-contain" priority />
          </div>
          <div className={`leading-tight min-w-0 flex-1 ${effectiveCollapsed ? "md:hidden" : ""}`}>
            <div className="font-black tracking-tight text-white text-[15px] truncate">Nairobi City County</div>
            <div className="text-[10px] font-bold text-county-yellow tracking-[0.18em] uppercase mt-0.5">Mji-Move</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="md:hidden h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden md:flex absolute -right-3 top-[68px] z-20 h-6 w-6 rounded-full bg-county-cream text-county-green-deep shadow-md items-center justify-center hover:bg-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform ${collapsed ? "rotate-180" : ""}`}>
            <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

      <nav className="flex-1 p-3 space-y-1 relative z-10 overflow-y-auto">
        {(() => {
          const sections: string[] = [];
          for (const item of navItems) {
            if (item.section && !sections.includes(item.section)) sections.push(item.section);
          }

          function renderItem(item: NavItem) {
            const isActive = active === item.href || (item.href === "/revenue" && active === "/fines");
            const Icon = NAV_ICONS[item.href];
            return (
              <Link
                key={item.href}
                href={item.href}
                title={effectiveCollapsed ? item.label : undefined}
                className={`group flex items-center rounded-lg text-sm font-semibold transition-all duration-150 relative ${
                  effectiveCollapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3.5 py-2.5"
                } ${
                  isActive
                    ? "bg-county-cream text-county-green-deep shadow-sm"
                    : "text-white/75 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {isActive && !effectiveCollapsed && <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-county-yellow" />}
                {effectiveCollapsed ? (
                  <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${isActive ? "bg-county-green-deep/10" : "bg-white/10"}`}>
                    {Icon ? <Icon size={16} strokeWidth={2} /> : item.label.trim().charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <>
                    {Icon && <Icon size={17} strokeWidth={2} className="shrink-0" />}
                    <span className={isActive ? "font-extrabold" : ""}>{item.label}</span>
                  </>
                )}
              </Link>
            );
          }

          return (
            <>
              {navItems.filter((item) => !item.section).map(renderItem)}
              {sections.map((section) => {
                const items = navItems.filter((item) => item.section === section);
                const isCollapsed = collapsedSections.has(section) && !effectiveCollapsed;
                return (
                  <div key={section} className="pt-1">
                    {!effectiveCollapsed && (
                      <button
                        type="button"
                        onClick={() => toggleSection(section)}
                        className="w-full flex items-center justify-between px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-white/60"
                      >
                        {section}
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>
                          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                    {!isCollapsed && items.map(renderItem)}
                  </div>
                );
              })}
            </>
          );
        })()}
      </nav>

      <div className="relative z-10 p-4 border-t border-white/10 bg-black/20 space-y-3">
        {!effectiveCollapsed && (
          <>
            <div className="flex items-center justify-center gap-3 text-[10px] font-bold text-white/50">
              <Link href="/faq" target="_blank" className="hover:text-county-yellow hover:underline">{t("footer.help")}</Link>
              <span className="text-white/20">·</span>
              <Link href="/terms" target="_blank" className="hover:text-county-yellow hover:underline">{t("footer.terms")}</Link>
            </div>
            <div className="text-[9px] font-bold text-center text-white/40 uppercase tracking-[0.2em]">
              Official County Portal
            </div>
          </>
        )}
        <form action={logoutAction}>
          <button
            type="submit"
            title={effectiveCollapsed ? t("nav.signOut") : undefined}
            className={`w-full rounded-lg border border-county-red/40 bg-county-red/90 hover:bg-county-red text-white font-bold transition-colors shadow-sm flex items-center justify-center ${
              effectiveCollapsed ? "py-2.5" : "gap-2 px-3.5 py-2 text-xs"
            }`}
          >
            <LogOut size={effectiveCollapsed ? 16 : 14} strokeWidth={2} />
            {!effectiveCollapsed && t("nav.signOut")}
          </button>
        </form>
      </div>
      </aside>
    </>
  );
}
