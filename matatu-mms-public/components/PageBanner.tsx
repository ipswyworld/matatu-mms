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
 * Page header matching the Nairobi eServices visual language: deep forest
 * green carrying identity + title, a small county crest chip on the right.
 * Deliberately compact — this renders at the top of every page in the app,
 * so its height is a permanent tax on every screen's vertical space, not a
 * one-time hero. Used consistently across all dashboards.
 */
export default function PageBanner({ eyebrow, title, titleBadge, subtitle, action, icon: Icon }: PageBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-county-green-deep text-white shadow-sm ring-1 ring-black/5">
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
        className="pointer-events-none absolute top-0 right-0 h-14 w-14"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <polygon points="35,0 100,0 100,65" fill="#F5C518" />
        <polygon points="65,0 100,0 100,35" fill="#0F5132" />
        <polygon points="55,0 100,0 100,45" fill="none" stroke="#F5C518" strokeWidth="1" opacity="0.4" />
      </svg>

      {/* County crest, floated on the right in its own circular chip */}
      <div className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 hidden md:flex h-14 w-14 items-center justify-center">
        <div className="absolute inset-0 rounded-full ring-1 ring-county-yellow/30" />
        <div className="h-10 w-10 rounded-full bg-county-cream flex items-center justify-center overflow-hidden shadow-md ring-2 ring-white/20">
          <img src="/nairobi-crest.jpg" alt="" className="h-full w-full object-contain" />
        </div>
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 md:pr-20">
        <div className="min-w-0 flex items-center gap-3">
          {Icon && (
            <span className="hidden sm:flex h-9 w-9 shrink-0 rounded-lg bg-white/10 ring-1 ring-white/15 items-center justify-center text-county-yellow">
              <Icon size={17} strokeWidth={2} />
            </span>
          )}
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-county-yellow/90 truncate">
              {eyebrow}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base md:text-lg leading-tight font-black tracking-tight text-white truncate">
                {title}
              </h1>
              {titleBadge}
            </div>
            {subtitle && (
              <p className="text-[11px] text-white/60 mt-0.5 leading-snug line-clamp-2 max-w-xl">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {action && <div className="flex flex-wrap items-center gap-2.5 shrink-0">{action}</div>}
      </div>
    </div>
  );
}
