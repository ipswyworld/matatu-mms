"use client";

import { DutyCalendar as DutyCalendarData } from "@/lib/types";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface DutyCalendarProps {
  calendar: DutyCalendarData;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

/**
 * Month grid for the duty sheet. Counts come from the backend, which
 * resolves each posting's DAILY/WEEKDAY/WEEKEND coverage against every
 * date — so a weekend cell genuinely shows the weekend allocation rather
 * than the same number repeated across the month.
 *
 * Monday-first, because that is how a duty week is read here, not the
 * Sunday-first default of most date libraries.
 */
export default function DutyCalendar({ calendar, selectedDate, onSelectDate }: DutyCalendarProps) {
  if (!calendar.days.length) return null;

  // Pad the first week so day 1 lands under its real weekday. getDay() is
  // Sunday=0; shifting by 6 and taking mod 7 turns it Monday-first.
  const firstDate = new Date(`${calendar.days[0].date}T00:00:00`);
  const leadingBlanks = (firstDate.getDay() + 6) % 7;

  const monthLabel = firstDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const busiest = Math.max(...calendar.days.map((d) => d.assignmentCount), 1);

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-county-black">Duty calendar</h3>
          <p className="text-[11px] text-black/50 mt-0.5">
            {monthLabel} · tap a day to see who is posted
          </p>
        </div>
        {calendar.allocationStatus && (
          <span
            className={`badge text-[10px] font-extrabold ${
              calendar.allocationStatus === "PUBLISHED"
                ? "bg-county-green/10 text-county-green"
                : "bg-county-yellow/20 text-county-yellow-dark"
            }`}
          >
            {calendar.allocationStatus}
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-[10px] font-bold uppercase tracking-wide text-black/40 text-center pb-1"
          >
            {label}
          </div>
        ))}

        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`blank-${i}`} aria-hidden />
        ))}

        {calendar.days.map((day) => {
          const dayNumber = Number(day.date.slice(-2));
          const isSelected = selectedDate === day.date;
          // Intensity, not a hard threshold — a quiet day and a full one
          // should look different at a glance without needing the number.
          const intensity = day.assignmentCount / busiest;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelectDate(day.date)}
              aria-pressed={isSelected}
              aria-label={`${day.date}, ${day.assignmentCount} posting${day.assignmentCount === 1 ? "" : "s"}`}
              className={`relative rounded-lg border p-2 text-left transition-colors min-h-[58px] ${
                isSelected
                  ? "border-county-green bg-county-green/10 ring-1 ring-county-green"
                  : day.isWeekend
                    ? "border-black/5 bg-county-yellow/[0.07] hover:border-county-green/40"
                    : "border-black/5 bg-white hover:border-county-green/40"
              }`}
            >
              <span className="text-xs font-bold text-county-black">{dayNumber}</span>
              {day.assignmentCount > 0 && (
                <>
                  <span className="block text-[10px] font-semibold text-black/55 mt-0.5">
                    {day.assignmentCount}
                  </span>
                  <span
                    className="absolute bottom-1.5 left-2 right-2 h-1 rounded-full bg-county-green"
                    style={{ opacity: 0.25 + intensity * 0.75 }}
                  />
                </>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-black/5 text-[10px] text-black/45">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-county-yellow/40" /> Weekend allocation
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-county-green" /> Officers posted
        </span>
      </div>
    </div>
  );
}
