"use client";

import { useEffect } from "react";
import MatatuGlyph from "@/components/MatatuGlyph";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-county-cream px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto h-24 w-24 rounded-2xl bg-county-red flex items-center justify-center text-white shadow-elevated">
          <MatatuGlyph size={56} />
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-county-red">System error</div>
          <h1 className="text-3xl font-black tracking-tight text-county-ink mt-2">Something broke down</h1>
          <p className="text-sm text-county-ink/60 mt-3 leading-relaxed">
            The system hit an unexpected fault loading this page. This has been logged. You can try again,
            or head back to a known-good page.
          </p>
          {error.digest && (
            <p className="text-[11px] font-mono text-county-ink/35 mt-2">Reference: {error.digest}</p>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => reset()} className="btn-primary !px-6">
            Try again
          </button>
          <a href="/dashboard" className="btn-secondary !px-6">
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
