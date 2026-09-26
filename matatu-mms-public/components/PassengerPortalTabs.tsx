"use client";

import { useRef, useState, type ReactNode } from "react";
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
 *
 * A real WAI-ARIA tabs implementation, not just role="tab" for the label:
 * each tab/panel pair is linked via id/aria-controls/aria-labelledby, only
 * the active tab sits in the regular tab order (roving tabindex), and
 * arrow keys move both focus and selection together (the standard
 * "automatic activation" tabs pattern a screen-reader user expects the
 * moment something announces itself as role="tab").
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
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ book: null, scheduled: null, saved: null });

  const tabs: { id: Tab; label: string; icon: typeof Bus; badge?: number }[] = [
    { id: "book", label: "Book Now", icon: Bus },
    { id: "scheduled", label: "Scheduled", icon: CalendarClock, badge: scheduledCount },
    { id: "saved", label: "Saved Places", icon: Star },
  ];

  const activate = (id: Tab) => {
    setTab(id);
    tabRefs.current[id]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      activate(tabs[(index + 1) % tabs.length].id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      activate(tabs[(index - 1 + tabs.length) % tabs.length].id);
    } else if (e.key === "Home") {
      e.preventDefault();
      activate(tabs[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      activate(tabs[tabs.length - 1].id);
    }
  };

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Passenger portal sections" className="flex items-center gap-1 border-b border-county-ink/[0.08]">
        {tabs.map(({ id, label, icon: Icon, badge }, index) => {
          const active = tab === id;
          return (
            <button
              key={id}
              ref={(el) => { tabRefs.current[id] = el; }}
              id={`portal-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`portal-panel-${id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => activate(id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
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

      {tabs.map(({ id }) => (
        <div
          key={id}
          id={`portal-panel-${id}`}
          role="tabpanel"
          aria-labelledby={`portal-tab-${id}`}
          tabIndex={0}
          hidden={tab !== id}
        >
          {tab === id && (id === "book" ? bookNow : id === "scheduled" ? scheduled : saved)}
        </div>
      ))}
    </div>
  );
}
