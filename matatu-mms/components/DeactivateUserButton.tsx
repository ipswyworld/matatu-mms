"use client";

import { useState, useTransition } from "react";
import { setUserActiveAction } from "@/lib/actions";

export default function DeactivateUserButton({ userId, isActive }: { userId: string; isActive: boolean }) {
  const [active, setActive] = useState(isActive);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const apply = (next: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await setUserActiveAction(userId, next);
      if (result.error) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      setActive(next);
      setConfirming(false);
    });
  };

  if (active) {
    if (!confirming) {
      return (
        <button onClick={() => setConfirming(true)} className="text-[11px] font-bold text-county-red hover:underline">
          Deactivate
        </button>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-black/50">Confirm?</span>
        <button
          disabled={isPending}
          onClick={() => apply(false)}
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

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold text-black/40">Deactivated</span>
      <button disabled={isPending} onClick={() => apply(true)} className="text-[11px] font-bold text-county-green hover:underline">
        {isPending ? "..." : "Reactivate"}
      </button>
      {error && <span className="text-[10px] text-county-red font-semibold ml-1">{error}</span>}
    </div>
  );
}
