"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export default function UsersTabs({
  staffCount,
  publicCount,
  staffPanel,
  publicPanel,
}: {
  staffCount: number;
  publicCount: number;
  staffPanel: ReactNode;
  publicPanel: ReactNode;
}) {
  const [tab, setTab] = useState<"staff" | "public">("staff");

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 border-b border-black/10">
        {(
          [
            { key: "staff", label: "County Staff", count: staffCount },
            { key: "public", label: "Public Directory", count: publicCount },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-county-green text-county-green"
                : "border-transparent text-black/40 hover:text-black/60"
            }`}
          >
            {t.label} <span className="text-[10px] font-normal">({t.count})</span>
          </button>
        ))}
      </div>
      {tab === "staff" ? staffPanel : publicPanel}
    </div>
  );
}
