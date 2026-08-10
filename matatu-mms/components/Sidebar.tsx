"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Role } from "@/lib/types";
import { can } from "@/lib/rbac";

export default function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const active = "/" + (pathname?.split("/")[1] || "");

  const getNavItems = () => {
    if (role === "PASSENGER") {
      return [
        { href: "/passenger-portal", label: "Passenger Portal", action: "view_passenger_portal" as const },
      ];
    }
    if (role === "CREW") {
      return [
        { href: "/crew-portal", label: "Crew Dashboard", action: "view_crew_portal" as const },
      ];
    }
    if (role === "SACCO_OPERATOR") {
      return [
        { href: "/sacco-portal", label: "Sacco Dashboard", action: "view_sacco_portal" as const },
        { href: "/matatus", label: "Fleet Registry", action: "view_matatus" as const },
        { href: "/revenue", label: "Revenue & Permits", action: "view_revenue" as const },
        { href: "/routes", label: "Assigned Routes", action: "view_routes" as const },
      ];
    }
    if (role === "ENFORCEMENT") {
      return [
        { href: "/enforcement", label: "Overview", action: "view_enforcement" as const },
        { href: "/matatus", label: "Fleet Lookup", action: "view_matatus" as const },
        { href: "/activity", label: "My Activity Log", action: "view_activity" as const },
      ];
    }
    if (role === "ARRESTING_OFFICER") {
      return [
        { href: "/enforcement", label: "Overview", action: "view_enforcement" as const },
        { href: "/enforcement/scene", label: "Report Offence", action: "file_enforcement_case" as const },
        { href: "/enforcement/cases", label: "My Cases", action: "view_enforcement_cases" as const },
        { href: "/matatus", label: "Fleet Lookup", action: "view_matatus" as const },
        { href: "/activity", label: "My Activity Log", action: "view_activity" as const },
      ];
    }
    if (role === "RELEASING_OFFICER") {
      return [
        { href: "/enforcement", label: "Overview", action: "view_enforcement" as const },
        { href: "/enforcement/cases", label: "Case Queue", action: "view_enforcement_cases" as const },
        { href: "/matatus", label: "Fleet Lookup", action: "view_matatus" as const },
        { href: "/activity", label: "My Activity Log", action: "view_activity" as const },
      ];
    }
    if (role === "ENFORCEMENT_COMMANDER") {
      return [
        { href: "/enforcement", label: "Overview", action: "view_enforcement" as const },
        { href: "/enforcement/cases", label: "Case Queue", action: "view_enforcement_cases" as const },
        { href: "/enforcement/scene", label: "Report Offence", action: "file_enforcement_case" as const },
        { href: "/matatus", label: "Fleet Lookup", action: "view_matatus" as const },
        { href: "/activity", label: "My Activity Log", action: "view_activity" as const },
      ];
    }
    if (role === "DIRECTOR_MOBILITY" || role === "CHIEF_OFFICER") {
      return [
        { href: "/dashboard", label: "Overview", action: "view_dashboard" as const },
        { href: "/saccos/verify", label: "Operator Verification", action: "view_operator_verification" as const },
      ];
    }
    if (role === "DATA_ANALYST") {
      return [
        { href: "/dashboard", label: "Overview", action: "view_dashboard" as const },
        { href: "/matatus", label: "Fleet Registry", action: "view_matatus" as const },
        { href: "/enforcement", label: "Enforcement", action: "view_enforcement" as const },
        { href: "/revenue", label: "Revenue & Permits", action: "view_revenue" as const },
        { href: "/audit-logs", label: "Audit Trail", action: "view_audit_logs" as const },
      ];
    }
    // ADMIN / VIEWER
    return [
      { href: "/dashboard", label: "Overview", action: "view_dashboard" as const },
      { href: "/saccos/verify", label: "Operator Verification", action: "verify_saccos" as const },
      { href: "/matatus", label: "Fleet Registry", action: "view_matatus" as const },
      { href: "/enforcement", label: "Enforcement", action: "view_enforcement" as const },
      { href: "/activity", label: "Activity Log", action: "view_activity" as const },
      { href: "/passengers", label: "Passengers Feedback", action: "view_passengers" as const },
      { href: "/revenue", label: "Revenue & Permits", action: "view_revenue" as const },
      { href: "/routes", label: "Routes Management", action: "view_routes" as const },
      { href: "/users", label: "Users & Roles", action: "view_users" as const },
      { href: "/audit-logs", label: "Audit Trail", action: "view_audit_logs" as const },
    ];
  };

  const navItems = getNavItems().filter((item) => can(role, item.action));

  return (
    <aside className="relative w-64 shrink-0 bg-county-green-deep text-white min-h-screen flex flex-col border-r border-black/10 overflow-hidden">
      {/* Sidebar Header — real logo + wordmark on a cream chip so the crest reads correctly */}
      <div className="p-5 flex items-center gap-3 border-b border-white/10 bg-black/10">
        <div className="h-11 w-11 shrink-0 rounded-xl bg-county-cream flex items-center justify-center overflow-hidden shadow-md">
          <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={44} height={44} className="object-contain" priority />
        </div>
        <div className="leading-tight">
          <div className="font-black tracking-tight text-white text-[15px]">Nairobi City County</div>
          <div className="text-[10px] font-bold text-county-yellow tracking-[0.18em] uppercase mt-0.5">Matatu MMS</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 relative z-10">
        {navItems.map((item) => {
          const isActive = active === item.href || (item.href === "/revenue" && active === "/fines");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-all duration-150 relative ${
                isActive
                  ? "bg-county-cream text-county-green-deep shadow-sm"
                  : "text-white/75 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {isActive && <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-county-yellow" />}
              <span className={isActive ? "font-extrabold" : ""}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="relative z-10 p-4 border-t border-white/10 bg-black/20 space-y-2">
        <div className="flex items-center justify-center gap-3 text-[10px] font-bold text-white/50">
          <Link href="/faq" target="_blank" className="hover:text-county-yellow hover:underline">Help &amp; FAQ</Link>
          <span className="text-white/20">·</span>
          <Link href="/terms" target="_blank" className="hover:text-county-yellow hover:underline">Terms</Link>
        </div>
        <div className="text-[9px] font-bold text-center text-white/40 uppercase tracking-[0.2em]">
          Official County Portal
        </div>
        <div className="h-1.5 w-full rounded-full overflow-hidden flex">
          <div className="bg-county-green flex-1" />
          <div className="bg-county-yellow flex-1" />
          <div className="bg-county-red flex-1" />
        </div>
      </div>
    </aside>
  );
}
