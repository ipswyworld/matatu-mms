"use client";

import { useState, ReactNode } from "react";

type TabKey = "operations" | "command" | "duty";

export default function EnforcementTabs({
  operationsContent,
  commandContent,
  dutyContent,
}: {
  operationsContent: ReactNode;
  commandContent?: ReactNode;
  /** The monthly duty allocation console. Lives here beside Command
   *  Centre rather than as its own top-level page: posting officers is
   *  enforcement command work, and splitting it out meant a commander
   *  bouncing between two sections to do one job. */
  dutyContent?: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("operations");

  if (!commandContent && !dutyContent) {
    return <>{operationsContent}</>;
  }

  const tabs: { key: TabKey; label: string; content: ReactNode }[] = [
    { key: "operations", label: "Operations", content: operationsContent },
    ...(commandContent ? [{ key: "command" as const, label: "Command Centre", content: commandContent }] : []),
    ...(dutyContent ? [{ key: "duty" as const, label: "Duty Allocation", content: dutyContent }] : []),
  ];

  const active = tabs.find((t) => t.key === tab) || tabs[0];

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-black/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={active.key === t.key ? "page" : undefined}
            className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
              active.key === t.key
                ? "border-county-green text-county-green"
                : "border-transparent text-black/50 hover:text-black/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active.content}
    </div>
  );
}
