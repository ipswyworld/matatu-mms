import type { Metadata } from "next";
import { CalendarCheck, MapPin, Radio } from "lucide-react";
import { getMyBroadcasts, getMyDuty } from "@/lib/data";
import PageBanner from "@/components/PageBanner";
import DutyStatusPill from "@/components/duty/DutyStatusPill";
import BroadcastInbox from "@/components/duty/BroadcastInbox";

export const metadata: Metadata = { title: "My Duty" };

/**
 * The officer's own screen — "once you are allocated work you will see the
 * allocation on your end". Deliberately the plainest page in the app:
 * where am I posted today, what shift, am I on duty, and what have I been
 * told. Everything else is one scroll down.
 */
export default async function MyDutyPage() {
  const [duty, broadcasts] = await Promise.all([getMyDuty(), getMyBroadcasts()]);

  if (!duty) {
    return (
      <div className="space-y-6">
        <PageBanner
          eyebrow="Nairobi City County"
          title="My Duty"
          subtitle="Your posting, shift and orders."
          icon={CalendarCheck}
        />
        <div className="card p-6 text-center">
          <p className="text-sm font-semibold text-county-black">No duty allocation for this account.</p>
          <p className="text-xs text-black/50 mt-1">
            Duty postings apply to enforcement officers. If you believe this is wrong, speak to your
            sector commander.
          </p>
        </div>
      </div>
    );
  }

  const todayLabel = new Date(`${duty.date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Public Transport Control Unit"
        title="My Duty"
        subtitle={`${todayLabel}${duty.allocationMonth ? ` · ${duty.allocationMonth} allocation` : ""}`}
        icon={CalendarCheck}
      />

      {/* The single most important fact on this page, stated first. */}
      <div
        className={`card p-6 border-l-0 ${
          duty.onDutyToday ? "bg-county-green/[0.06]" : "bg-county-yellow/[0.08]"
        }`}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Today</p>
            <p className="text-2xl font-black text-county-black mt-1">
              {duty.onDutyToday ? "You are on duty" : "You are not on duty today"}
            </p>
            {!duty.onDutyToday && duty.dutyStatus !== "ON_DUTY" && (
              <p className="text-xs text-black/60 mt-1">
                Recorded as <strong>{duty.dutyStatus.replace("_", " ").toLowerCase()}</strong>
                {duty.dutyStatusUntil ? ` until ${duty.dutyStatusUntil}` : ""}
                {duty.dutyStatusNote ? ` — ${duty.dutyStatusNote}` : ""}.
              </p>
            )}
            {!duty.onDutyToday && duty.dutyStatus === "ON_DUTY" && duty.today.length === 0 && (
              <p className="text-xs text-black/60 mt-1">
                {duty.allocationMonth
                  ? "You have no posting for today in this month's allocation."
                  : "No allocation has been published for this month yet."}
              </p>
            )}
          </div>
          <DutyStatusPill status={duty.dutyStatus} />
        </div>

        {duty.today.length > 0 && (
          <div className="mt-5 space-y-3">
            {duty.today.map((posting) => (
              <div key={posting.id} className="rounded-xl bg-white border border-black/[0.07] p-4">
                <div className="flex items-start gap-3">
                  <MapPin size={16} strokeWidth={2} className="text-county-green shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-county-black">{posting.workStation}</p>
                    <p className="text-[11px] text-black/55 mt-0.5">
                      {posting.zoneName ? `${posting.zoneName} · ` : ""}
                      {posting.sectorName ? `Sector ${posting.sectorCode} — ${posting.sectorName}` : ""}
                    </p>
                    {posting.postingRole && (
                      <p className="text-[11px] font-bold text-county-green mt-1">{posting.postingRole}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-black/40">Shift</p>
                    <p className="text-sm font-black text-county-black">{posting.shift}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <BroadcastInbox broadcasts={broadcasts} />

      {duty.month.length > 0 && (
        <div className="card p-5">
          <h3 className="font-bold text-sm text-county-black mb-1">
            My postings this month
          </h3>
          <p className="text-[11px] text-black/50 mb-3">
            {duty.allocationReference ? `Ref ${duty.allocationReference}` : duty.allocationMonth}
          </p>
          <ul className="divide-y divide-black/[0.05]">
            {duty.month.map((posting) => (
              <li key={posting.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-county-black">{posting.workStation}</p>
                  <p className="text-[10px] text-black/45 mt-0.5">
                    {posting.zoneName || posting.sectorName || "—"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-black/50">
                    {posting.shift}
                  </p>
                  <p className="text-[10px] text-black/40">
                    {posting.coverage === "DAILY"
                      ? "Every day"
                      : posting.coverage === "WEEKEND"
                        ? "Weekends"
                        : "Weekdays"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
