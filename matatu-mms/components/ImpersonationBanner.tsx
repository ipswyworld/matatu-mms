"use client";

import { useTransition } from "react";
import { UserCog } from "lucide-react";
import { stopImpersonationAction } from "@/lib/actions";

// Persistent, can't-be-dismissed-except-by-ending-it — the whole point is
// that it's impossible to forget you're looking through someone else's
// account (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md A.3's impersonation
// requirement).
export default function ImpersonationBanner({ targetName, impersonatorName }: { targetName: string; impersonatorName: string }) {
  const [isPending, startTransition] = useTransition();

  function handleReturn() {
    startTransition(async () => {
      await stopImpersonationAction();
    });
  }

  return (
    <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 px-4 py-2 flex flex-wrap items-center justify-center gap-2 text-xs font-bold shadow-md">
      <UserCog size={14} strokeWidth={2.5} />
      <span>
        Viewing as <strong>{targetName}</strong> — impersonated by {impersonatorName}
      </span>
      <button
        type="button"
        onClick={handleReturn}
        disabled={isPending}
        className="ml-2 rounded-full bg-amber-950 text-amber-50 px-3 py-1 hover:bg-black transition-colors disabled:opacity-50"
      >
        {isPending ? "Returning…" : "Return to your account"}
      </button>
    </div>
  );
}
