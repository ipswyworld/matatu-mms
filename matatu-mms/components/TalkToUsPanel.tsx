"use client";

import { useState } from "react";

/**
 * A quieter, always-available "talk to a human" fallback — for when a
 * passenger's issue doesn't fit a category, or they'd rather just call
 * someone. Two visual contexts: the light card (feedback tab) and the dark
 * compact variant pinned in the passenger sidebar.
 */
export default function TalkToUsPanel({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);

  if (dark) {
    return (
      <div className="rounded-lg border border-white/15 bg-white/[0.06] overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-white/[0.04] transition-colors"
        >
          <span className="text-xs font-bold text-white/90">Talk to Us</span>
          <span className={`text-white/40 text-xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
        {open && (
          <div className="px-3.5 pb-3 pt-0.5 space-y-2 border-t border-white/10 text-[11px]">
            <a href="tel:+254202224411" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
              <span>☎</span> +254 20 222 4411
            </a>
            <a href="mailto:transport@nairobi.go.ke" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
              <span>✉</span> transport@nairobi.go.ke
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-black/[0.02] transition-colors"
      >
        <div>
          <h3 className="font-bold text-sm text-county-black">Talk to Us</h3>
          <p className="text-xs text-black/50">Prefer to speak to someone directly? We're here.</p>
        </div>
        <span className={`text-black/40 text-sm transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-black/5">
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <a href="tel:+254202224411" className="flex items-center gap-2.5 p-3 rounded-lg border border-black/10 hover:border-county-green/40 hover:bg-county-green/5 transition-colors">
              <span className="h-8 w-8 rounded-full bg-county-green/10 text-county-green flex items-center justify-center font-bold">☎</span>
              <div>
                <div className="font-bold text-county-black">Call the county line</div>
                <div className="text-black/50">+254 20 222 4411</div>
              </div>
            </a>
            <a href="mailto:transport@nairobi.go.ke" className="flex items-center gap-2.5 p-3 rounded-lg border border-black/10 hover:border-county-green/40 hover:bg-county-green/5 transition-colors">
              <span className="h-8 w-8 rounded-full bg-county-blue/10 text-county-blue flex items-center justify-center font-bold">✉</span>
              <div>
                <div className="font-bold text-county-black">Email us</div>
                <div className="text-black/50">transport@nairobi.go.ke</div>
              </div>
            </a>
          </div>
          <p className="text-[11px] text-black/40">Monday – Friday, 8:00 AM – 5:00 PM (East Africa Time)</p>
        </div>
      )}
    </div>
  );
}
