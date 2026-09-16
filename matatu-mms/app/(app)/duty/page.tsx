import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { readSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import {
  getDutyAllocations,
  getDutyAssignments,
  getDutyCalendar,
  getDutyZones,
  getOfficerRoster,
  getSectors,
} from "@/lib/data";
import PageBanner from "@/components/PageBanner";
import DutyConsole from "@/components/duty/DutyConsole";

export const metadata: Metadata = { title: "Duty Allocation" };

/**
 * The commander's duty console — the digital form of the PTCU's monthly
 * "ALLOCATION OF DUTY" sheet.
 *
 * Read access rides on view_users (every enforcement role has it, so an
 * officer can see the roster they are part of); every mutation is gated
 * separately on manage_duty_allocation / send_broadcast, checked again on
 * the backend rather than trusted from here.
 */
export default async function DutyPage() {
  const session = readSession()!;
  const canManage = can(session.role, "manage_duty_allocation");
  const canBroadcast = can(session.role, "send_broadcast");

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [allocations, sectors, zones, calendar] = await Promise.all([
    getDutyAllocations(),
    getSectors(),
    getDutyZones(),
    getDutyCalendar(year, month),
  ]);

  // This month's sheet if it exists, otherwise the most recent one — a
  // commander opening this on the 1st before the new sheet is drafted
  // should still see what is currently in force, not an empty screen.
  const current =
    allocations.find((a) => a.year === year && a.month === month) || allocations[0] || null;

  const [assignments, officers] = await Promise.all([
    current ? getDutyAssignments(current.id) : Promise.resolve([]),
    getOfficerRoster(current ? { allocationId: current.id } : {}),
  ]);

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Public Transport Control Unit"
        title="Duty Allocation"
        subtitle="Monthly sector and zone postings, officer duty status, and command broadcasts."
        icon={CalendarClock}
      />

      <DutyConsole
        allocation={current}
        allocations={allocations}
        sectors={sectors}
        zones={zones}
        assignments={assignments}
        officers={officers}
        calendar={calendar}
        canManage={canManage}
        canBroadcast={canBroadcast}
      />
    </div>
  );
}
