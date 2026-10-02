"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { uploadUrl } from "@/lib/uploads";

interface EvidenceGalleryProps {
  photos: string[];
  /** Shown in the lightbox header so an officer knows which case/crime
   *  the evidence belongs to once it fills the screen. */
  label?: string;
  size?: "sm" | "md";
}

/**
 * Scene evidence — the photos officers take at the roadside.
 *
 * These have always been captured (a case cannot be filed without at least
 * one, and a crime record requires one too) and stored, but until now the
 * only way to see one was a text link that said "Photo", and crime-record
 * photos had no UI at all. Evidence you cannot look at is evidence nobody
 * checks before making a decision on the case.
 */
export default function EvidenceGallery({ photos, label, size = "sm" }: EvidenceGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const usable = (photos || []).filter(Boolean);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
      if (e.key === "ArrowRight") setOpenIndex((i) => (i === null ? null : (i + 1) % usable.length));
      if (e.key === "ArrowLeft") setOpenIndex((i) => (i === null ? null : (i - 1 + usable.length) % usable.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, usable.length]);

  if (usable.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-black/30 italic">
        <ImageOff size={11} strokeWidth={2} />
        None
      </span>
    );
  }

  const box = size === "md" ? "h-16 w-16" : "h-10 w-10";

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {usable.map((path, i) => (
          <button
            key={path}
            type="button"
            onClick={() => setOpenIndex(i)}
            aria-label={`Open evidence photo ${i + 1} of ${usable.length}`}
            className={`${box} rounded-md overflow-hidden border border-black/10 hover:border-county-green transition-colors shrink-0 bg-black/[0.04]`}
          >
            {/* Plain <img>, not next/image: these are backend-served
                uploads on a different origin, and routing them through
                Next's optimizer would need that origin whitelisted in
                next.config.mjs for every deployment. */}
            <img
              src={uploadUrl(path)}
              alt={`Scene evidence ${i + 1}`}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label ? `Evidence for ${label}` : "Scene evidence"}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col"
          onClick={() => setOpenIndex(null)}
        >
          <div className="flex items-center justify-between p-4 text-white shrink-0">
            <div className="text-xs font-bold">
              {label && <span className="text-white/70 mr-2">{label}</span>}
              Photo {openIndex + 1} of {usable.length}
            </div>
            <button
              type="button"
              onClick={() => setOpenIndex(null)}
              aria-label="Close"
              className="text-white/70 hover:text-white"
            >
              <X size={20} strokeWidth={2.5} />
            </button>
          </div>

          <div
            className="flex-1 flex items-center justify-center gap-4 px-4 pb-6 min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            {usable.length > 1 && (
              <button
                type="button"
                onClick={() => setOpenIndex((i) => (i === null ? null : (i - 1 + usable.length) % usable.length))}
                aria-label="Previous photo"
                className="text-white/60 hover:text-white shrink-0"
              >
                <ChevronLeft size={28} strokeWidth={2.5} />
              </button>
            )}
            <img
              src={uploadUrl(usable[openIndex])}
              alt={`Scene evidence ${openIndex + 1}`}
              className="max-h-full max-w-full object-contain rounded-lg"
            />
            {usable.length > 1 && (
              <button
                type="button"
                onClick={() => setOpenIndex((i) => (i === null ? null : (i + 1) % usable.length))}
                aria-label="Next photo"
                className="text-white/60 hover:text-white shrink-0"
              >
                <ChevronRight size={28} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div className="text-center pb-4 shrink-0">
            <a
              href={uploadUrl(usable[openIndex])}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] font-bold text-white/60 hover:text-white underline"
            >
              Open full size in a new tab
            </a>
          </div>
        </div>
      )}
    </>
  );
}
