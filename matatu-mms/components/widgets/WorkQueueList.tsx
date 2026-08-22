import Link from "next/link";
import { Clock } from "lucide-react";

export interface WorkQueueItem {
  id: string;
  label: string;
  detail?: string;
  /** Pre-formatted age, e.g. "3 days", "6 hours" — computed by the caller
   * from whatever "submitted at" timestamp the domain has. */
  ageLabel?: string;
  href?: string;
}

export interface WorkQueueListProps {
  title: string;
  subtitle?: string;
  items: WorkQueueItem[];
  viewAllHref?: string;
  viewAllLabel?: string;
  emptyLabel?: string;
  /** Caps how many items render inline before "view all" takes over —
   * default 5. */
  maxVisible?: number;
}

/**
 * Generic "things waiting on you" widget (ADMIN_DASHBOARD_AUDIT §5.1) —
 * didn't exist in any form before this. Built for the still-missing
 * Director/Chief Officer work-queue dashboard ("applications awaiting my
 * stage, oldest first"), but generic enough for any approval/review queue
 * (dispute reviews, license renewals, ...). Caller supplies pre-sorted
 * items — oldest-first is a caller convention, not enforced here.
 */
export default function WorkQueueList({
  title,
  subtitle,
  items,
  viewAllHref,
  viewAllLabel = "View all",
  emptyLabel = "Nothing waiting — you're caught up.",
  maxVisible = 5,
}: WorkQueueListProps) {
  const oldest = items[0];
  const visible = items.slice(0, maxVisible);
  const overflowCount = items.length - visible.length;

  return (
    <div className="rounded-2xl bg-white p-4 md:p-5 shadow-sm ring-1 ring-county-ink/[0.06] flex flex-col">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">{title}</h3>
          {subtitle && <p className="text-[11px] text-county-ink/50 mt-1">{subtitle}</p>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-black tabular-nums text-county-ink">{items.length}</div>
          {oldest?.ageLabel && (
            <div className="text-[10px] font-bold text-county-ink/40 flex items-center gap-1 justify-end">
              <Clock size={10} strokeWidth={2.5} />
              oldest {oldest.ageLabel}
            </div>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-county-ink/40 text-center py-6">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 divide-y divide-county-ink/5">
          {visible.map((item) => {
            const row = (
              <div className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-county-ink truncate">{item.label}</div>
                  {item.detail && <div className="text-[11px] text-county-ink/50 truncate">{item.detail}</div>}
                </div>
                {item.ageLabel && (
                  <span className="text-[10px] font-bold text-county-ink/40 whitespace-nowrap shrink-0">{item.ageLabel}</span>
                )}
              </div>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className="block hover:bg-county-ink/[0.02] -mx-1 px-1 rounded">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}

      {viewAllHref && (overflowCount > 0 || items.length > 0) && (
        <Link href={viewAllHref} className="text-xs font-semibold text-county-green hover:underline mt-3 pt-3 border-t border-county-ink/5 text-center">
          {viewAllLabel}{overflowCount > 0 ? ` (${overflowCount} more)` : ""} →
        </Link>
      )}
    </div>
  );
}
