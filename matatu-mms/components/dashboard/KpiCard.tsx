import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: {
    label: string;
    tone: "positive" | "negative" | "attention" | "neutral";
  };
  accent?: "green" | "red" | "yellow" | "neutral";
  href?: string;
  icon?: LucideIcon;
}

const TONE_STYLES: Record<NonNullable<KpiCardProps["delta"]>["tone"], string> = {
  positive: "text-county-green",
  negative: "text-county-red",
  attention: "text-county-yellow-dark",
  neutral: "text-county-ink/50",
};

const ACCENT_STYLES: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  green: "before:bg-county-green",
  red: "before:bg-county-red",
  yellow: "before:bg-county-yellow",
  neutral: "before:bg-county-ink/15",
};

const ICON_WASH_STYLES: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  green: "bg-county-green/10 text-county-green",
  red: "bg-county-red/10 text-county-red",
  yellow: "bg-county-yellow/20 text-county-yellow-dark",
  neutral: "bg-county-ink/[0.06] text-county-ink/60",
};

/**
 * Corner-marker KPI: solid top border in accent color reads as decisive
 * without breaking the design's "no side-stripe" rule. Big numeric,
 * quiet label above, tone-tagged delta below.
 */
export default function KpiCard({ label, value, delta, accent = "neutral", href, icon: Icon }: KpiCardProps) {
  const inner = (
    <div
      className={`relative overflow-hidden rounded-2xl bg-white p-5 md:p-6 shadow-sm hover:shadow-md ring-1 ring-county-ink/[0.06] transition-all duration-200 before:absolute before:top-0 before:inset-x-0 before:h-1 ${ACCENT_STYLES[accent]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-county-ink/50">{label}</div>
        {Icon && (
          <span className={`shrink-0 h-8 w-8 rounded-lg flex items-center justify-center ${ICON_WASH_STYLES[accent]}`}>
            <Icon size={16} strokeWidth={2} />
          </span>
        )}
      </div>
      <div className="text-[38px] md:text-[44px] font-black tracking-tight text-county-ink leading-none mt-3">
        {value}
      </div>
      {delta && (
        <div className={`text-xs font-bold mt-3 ${TONE_STYLES[delta.tone]}`}>
          {delta.label}
        </div>
      )}
    </div>
  );
  // The whole card is already the click target when href is set — a
  // trailing "Open →" line was redundant with that, not an affordance for
  // it. hover:shadow-md above is the only cue the card needs.
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}
