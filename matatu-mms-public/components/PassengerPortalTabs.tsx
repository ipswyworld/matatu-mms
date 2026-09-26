"use client";

import { useState, type ReactNode } from "react";
import { Bus, CalendarClock, Star } from "lucide-react";

type Tab = "book" | "scheduled" | "saved";

/**
 * Top-level task switcher for the passenger portal. Before this, the page
 * simply stacked Favorites/Recents, the full instant-booking instrument
 * (map + search + browse-by-route + booking panel), and the entire
 * advance-scheduling form/list, one after another — a passenger had to
 * scroll past two other features' worth of UI just to reach the one they
 * came for. This makes "what am I trying to do" an explicit, page-level
 * choice instead of scroll position, matching PRODUCT.md's "one primary
 * task per screen" and "group by task, not by feature history" principles.
 *
 * Each tab unmounts the others rather than hiding them with CSS: the map
 * tab in particular holds a live GPS watch and a telemetry WebSocket that
 * have no reason to stay active while a passenger is looking at their
 * saved operators.
 */
export default function PassengerPortalTabs({
  bookNow,
  scheduled,
  saved,
  scheduledCount,
}: {
  bookNow: ReactNode;
  scheduled: ReactNode;
  saved: ReactNode;
  /** Upcoming (not cancelled/no-show) scheduled trips — surfaced as a small
   * badge so a passenger with a trip already booked ahead notices it exists
   * without having to check the tab speculatively. */
  scheduledCount: number;
}) {
  const [tab, setTab] = useState<Tab>("book");

  const tabs: { id: Tab; label: string; icon: typeof Bus; badge?: number }[] = [
    { id: "book", label: "Book Now", icon: Bus },
    { id: "scheduled", label: "Scheduled", icon: CalendarClock, badge: scheduledCount },
    { id: "saved", label: "Saved Places", icon: Star },
  ];

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Passenger portal sections" className="flex items-center gap-1 border-b border-county-ink/[0.08]">
        {tabs.map(({ id, label, icon: Icon, badge }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`relative flex items-center gap-1.5 px-4 py-3 text-sm font-bold transition-colors ${
                active ? "text-county-green" : "text-county-ink/50 hover:text-county-ink"
              }`}
            >
              <Icon size={16} strokeWidth={2} />
              {label}
              {Boolean(badge) && (
                <span className="badge bg-county-green/10 text-county-green font-extrabold text-[10px] !py-0.5">{badge}</span>
              )}
              {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-county-green" />}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === "book" && bookNow}
        {tab === "scheduled" && scheduled}
        {tab === "saved" && saved}
      </div>
    </div>
  );
}
