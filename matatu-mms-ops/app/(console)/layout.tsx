import { Settings, LogOut } from "lucide-react";
import { readSession } from "@/lib/session";
import { logoutAction } from "@/lib/actions";
import OpsNav from "@/components/OpsNav";
import CommandPalette from "@/components/CommandPalette";

/**
 * Console shell (Ops Console Rebuild Spec §5).
 *
 * Replaces the previous single 1,045-line scrolling page. The point is not
 * tidiness: during an incident an operator needs to reach one control
 * quickly, and scrolling past fifteen unrelated sections to find it is the
 * failure mode this structure exists to remove.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = readSession();

  return (
    <div className="min-h-screen bg-county-cream/40">
      <header className="bg-county-green-deep text-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <Settings size={16} strokeWidth={2} />
            </div>
            <div className="leading-tight min-w-0">
              <div className="font-black text-sm">Ops Console</div>
              <div className="text-[9px] font-bold text-county-yellow tracking-widest uppercase truncate">
                Nairobi City County · Super Admin
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <CommandPalette />
            <span className="text-xs font-semibold text-white/70 hidden sm:inline">{session?.name}</span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex items-center gap-1.5 text-xs font-bold text-white/70 hover:text-white transition-colors"
              >
                <LogOut size={14} /> Sign out
              </button>
            </form>
          </div>
        </div>

        <OpsNav />
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
