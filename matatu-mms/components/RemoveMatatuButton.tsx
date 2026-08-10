"use client";

import { useState, useTransition } from "react";
import { removeMatatuAction } from "@/lib/actions";

export default function RemoveMatatuButton({ matatuId, regNumber }: { matatuId: string; regNumber: string }) {
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (removed) {
    return <span className="text-[10px] font-bold text-black/40">Removed</span>;
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-[10px] font-bold text-county-red hover:underline"
      >
        Remove
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-black/50">Confirm?</span>
      <button
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await removeMatatuAction(matatuId);
            if (result.error) {
              setError(result.error);
              setConfirming(false);
              return;
            }
            setRemoved(true);
          })
        }
        className="text-[10px] font-bold text-white bg-county-red rounded px-1.5 py-0.5"
      >
        {isPending ? "..." : "Yes"}
      </button>
      <button onClick={() => setConfirming(false)} className="text-[10px] font-bold text-black/50">
        No
      </button>
      {error && <span className="text-[10px] text-county-red font-semibold ml-1">{error}</span>}
    </div>
  );
}
