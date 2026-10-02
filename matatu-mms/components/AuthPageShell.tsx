"use client";

import Image from "next/image";
import { ReactNode } from "react";
import LeaveCommentSection from "@/components/LeaveCommentSection";
import PublicFooter from "@/components/PublicFooter";
import LanguageToggle from "@/components/LanguageToggle";

interface AuthPageShellProps {
  eyebrow: string;
  heading: string;
  subheading: string;
  showLeaveComment?: boolean;
  children: ReactNode;
}

// Shared visual chrome for the two entry points ("/" public portal and
// "/login" staff sign-in) — brand panel, mobile crest, footer. Only the
// copy and the sign-in card's contents (passed as children) differ between
// the two, per the public/staff front-door split.
export default function AuthPageShell({ eyebrow, heading, subheading, showLeaveComment, children }: AuthPageShellProps) {
  return (
    <div className="h-screen flex bg-county-cream overflow-hidden">
      {/* Left brand panel — deep green with hex lattice and real crest */}
      <div className="relative hidden lg:flex lg:w-[46%] flex-col justify-between bg-county-green-deep text-white p-12 overflow-hidden">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.05]"
          viewBox="0 0 400 800"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <pattern id="loginhex" x="0" y="0" width="72" height="62" patternUnits="userSpaceOnUse">
              <path d="M36 0 L72 18 L72 54 L36 72 L0 54 L0 18 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </pattern>
          </defs>
          <rect width="400" height="800" fill="url(#loginhex)" />
        </svg>

        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-county-yellow/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-county-green/40 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-county-cream flex items-center justify-center overflow-hidden shadow-lg">
              <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={48} height={48} className="object-contain" priority />
            </div>
            <div className="leading-tight">
              <div className="font-black text-white text-base">Nairobi City County</div>
              <div className="text-[11px] font-bold text-county-yellow tracking-[0.18em] uppercase mt-0.5">{eyebrow}</div>
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-county-yellow mb-3">
            Mji-Move
          </div>
          <h1 className="text-[42px] leading-[1.05] font-black tracking-tight text-balance">
            {heading}
          </h1>
          <p className="text-white/70 text-[15px] leading-relaxed mt-5 max-w-md">
            {subheading}
          </p>
          <div className="mt-6 flex items-center gap-4">
            <LanguageToggle dark />
          </div>
          {showLeaveComment && (
            <div className="mt-4">
              <LeaveCommentSection />
            </div>
          )}
        </div>

        <div className="relative">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">
            County of Nairobi · Kenya
          </div>
        </div>
      </div>

      {/* Right column: sign-in panel with the footer pinned to its own bottom,
          not spanning the full page width under the green brand panel too. The
          page itself never scrolls; this inner area is the only scroll escape
          hatch, for edge cases like a short viewport with demo accounts open. */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="scrollbar-ghost flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6 md:p-8">
          <div className="w-full max-w-md space-y-5 py-4 auth-card-enter">
            <div className="flex lg:hidden items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-white flex items-center justify-center overflow-hidden shadow-md">
                <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={44} height={44} className="object-contain" />
              </div>
              <div className="leading-tight">
                <div className="font-black text-county-ink">Nairobi City County</div>
                <div className="text-[10px] font-bold text-county-green tracking-widest uppercase">Mji-Move</div>
              </div>
            </div>

            {children}
          </div>
        </div>
        {/* No custom topSlot here — PublicFooter's own nav already covers
            Help/Terms (its default LanguageToggle slot below), so a second
            Help&FAQ/Terms row was pure duplication and, on mobile where the
            left brand panel's toggle is hidden, silently removed the only
            way to switch language on this page. */}
        <PublicFooter />
      </div>
    </div>
  );
}
