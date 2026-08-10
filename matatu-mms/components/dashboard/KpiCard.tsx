import Link from "next/link";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: {
    label: string;
    tone: "positive" | "negative" | "attention" | "neutral";
  };
  accent?: "green" | "red" | "yellow" | "neutral";
  href?: string;
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

/**
 * Corner-marker KPI: solid top border in accent color reads as decisive
 * without breaking the design's "no side-stripe" rule. Big numeric,
 * quiet label above, tone-tagged delta below.
 */
export default function KpiCard({ label, value, delta, accent = "neutral", href }: KpiCardProps) {
  const inner = (
    <div
      className={`relative overflow-hidden rounded-2xl bg-white p-5 md:p-6 shadow-sm hover:shadow-md ring-1 ring-county-ink/[0.06] transition-all duration-200 before:absolute before:top-0 before:inset-x-0 before:h-1 ${ACCENT_STYLES[accent]}`}
    >
      <div className="text-[11px] font-bold uppercase tracking-wider text-county-ink/50">{label}</div>
      <div className="text-[38px] md:text-[44px] font-black tracking-tight text-county-ink leading-none mt-3">
        {value}
      </div>
      {delta && (
        <div className={`text-xs font-bold mt-3 ${TONE_STYLES[delta.tone]}`}>
          {delta.label}
        </div>
      )}
      {href && (
        <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-county-green">Open →</div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}
