"use client";

import { useState, ReactNode } from "react";

export default function EnforcementTabs({
  operationsContent,
  commandContent,
}: {
  operationsContent: ReactNode;
  commandContent?: ReactNode;
}) {
  const [tab, setTab] = useState<"operations" | "command">("operations");

  if (!commandContent) {
    return <>{operationsContent}</>;
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-black/10">
        <button
          onClick={() => setTab("operations")}
          className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
            tab === "operations" ? "border-county-green text-county-green" : "border-transparent text-black/50 hover:text-black/70"
          }`}
        >
          Operations
        </button>
        <button
          onClick={() => setTab("command")}
          className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
            tab === "command" ? "border-county-green text-county-green" : "border-transparent text-black/50 hover:text-black/70"
          }`}
        >
          Command Centre
        </button>
      </div>

      {tab === "operations" ? operationsContent : commandContent}
    </div>
  );
}
