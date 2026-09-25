"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Briefcase, Users, Plug, SlidersHorizontal, ScrollText, Server, KeyRound, History, Phone } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Activity, hint: "What is wrong right now" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, hint: "Queue depth, retries, cancellation" },
  { href: "/sessions", label: "Sessions", icon: Users, hint: "Sign-ins, account locks, MFA resets" },
  { href: "/integrations", label: "Integrations", icon: Plug, hint: "Circuit breakers and webhook deliveries" },
  { href: "/config", label: "Config", icon: SlidersHorizontal, hint: "Feature flags and live rate limits" },
  { href: "/api-clients", label: "API Clients", icon: KeyRound, hint: "Issue and revoke partner credentials" },
  { href: "/audit", label: "Audit", icon: ScrollText, hint: "Every recorded action" },
  { href: "/infrastructure", label: "Infrastructure", icon: Server, hint: "Deployed versions, alerting, metrics" },
  { href: "/changelog", label: "Changelog", icon: History, hint: "What shipped, when" },
  { href: "/on-call", label: "On-Call", icon: Phone, hint: "Who to page" },
];

export default function OpsNav() {
  const pathname = usePathname();

  return (
    <nav className="border-t border-white/10">
      <div className="max-w-7xl mx-auto px-6 flex items-center gap-1 overflow-x-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? "border-county-yellow text-white"
                  : "border-transparent text-white/55 hover:text-white/85"
              }`}
            >
              <Icon size={13} strokeWidth={2.2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
