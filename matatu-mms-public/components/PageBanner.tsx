import type { LucideIcon } from "lucide-react";

interface PageBannerProps {
  eyebrow: string;
  title: string;
  titleBadge?: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
}

/**
 * Page hero matching the Nairobi eServices visual language: deep forest green
 * on the left carrying identity + title, cream texture on the right with
 * decorative hexagon lattice — a nod to the reference site without lifting
 * imagery. Used consistently across all dashboards.
 */
export default function PageBanner({ eyebrow, title, titleBadge, subtitle, action, icon: Icon }: PageBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-county-green-deep text-white shadow-elevated ring-1 ring-black/5">
      {/* Hexagon lattice, decorative — same shape family the reference uses */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2 text-white/[0.06]"
        viewBox="0 0 400 200"
        preserveAspectRatio="xMaxYMid slice"
      >
        <defs>
          <pattern id="hex" x="0" y="0" width="60" height="52" patternUnits="userSpaceOnUse">
            <path d="M30 0 L60 15 L60 45 L30 60 L0 45 L0 15 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </pattern>
        </defs>
        <rect width="400" height="200" fill="url(#hex)" />
      </svg>

      {/* Angled yellow corner cut, echoing the reference site's top-right ribbon */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 h-32 w-32"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <polygon points="35,0 100,0 100,65" fill="#F5C518" />
        <polygon points="65,0 100,0 100,35" fill="#0F5132" />
        <polygon points="55,0 100,0 100,45" fill="none" stroke="#F5C518" strokeWidth="1" opacity="0.4" />
      </svg>

      {/* County crest, floated on the right in its own circular chip */}
      <div className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 hidden md:flex h-32 w-32 items-center justify-center">
        <div className="absolute inset-0 rounded-full ring-1 ring-county-yellow/30" />
        <div className="h-20 w-20 rounded-full bg-county-cream flex items-center justify-center overflow-hidden shadow-xl ring-2 ring-white/20">
          <img src="/nairobi-crest.jpg" alt="" className="h-full w-full object-contain" />
        </div>
      </div>

      <div className="relative flex flex-wrap items-end justify-between gap-4 px-6 py-8 md:px-10 md:py-10 md:pr-52">
        <div className="max-w-2xl">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-county-yellow">
            {eyebrow}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {Icon && (
              <span className="hidden sm:flex h-10 w-10 shrink-0 rounded-xl bg-white/10 ring-1 ring-white/15 items-center justify-center text-county-yellow">
                <Icon size={20} strokeWidth={2} />
              </span>
            )}
            <h1 className="text-[28px] md:text-[34px] leading-[1.05] font-black tracking-tight text-white text-balance">
              {title}
            </h1>
            {titleBadge}
          </div>
          {subtitle && (
            <p className="text-[13px] md:text-sm text-white/70 mt-3 max-w-xl leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2.5">{action}</div>}
      </div>
    </div>
  );
}
