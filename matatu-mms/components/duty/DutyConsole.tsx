"use client";

import { useState } from "react";
import { CalendarDays, CheckCircle2, FileText } from "lucide-react";
import { createDutyAllocationAction, publishDutyAllocationAction } from "@/lib/actions";
import {
  DutyAllocation,
  DutyAssignment,
  DutyCalendar as DutyCalendarData,
  OfficerRoster,
  Sector,
  Zone,
} from "@/lib/types";
import BroadcastComposer, { BroadcastTarget } from "./BroadcastComposer";
import DutyCalendar from "./DutyCalendar";
import DutyMap from "./DutyMap";
import OfficerRosterTable from "./OfficerRosterTable";
import PostOfficerForm from "./PostOfficerForm";
import SectorZoneBrowser from "./SectorZoneBrowser";
import { useTransition } from "react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface DutyConsoleProps {
  allocation: DutyAllocation | null;
  allocations: DutyAllocation[];
  sectors: Sector[];
  zones: Zone[];
  assignments: DutyAssignment[];
  officers: OfficerRoster[];
  calendar: DutyCalendarData;
  canManage: boolean;
  canBroadcast: boolean;
}

/**
 * Holds the two pieces of state the panels share: which day is selected
 * (the calendar sets it, the sector browser filters on it) and which
 * broadcast target is pending (the sector browser sets it, the composer
 * opens on it). Everything else is server-rendered and passed down.
 */
export default function DutyConsole({
  allocation,
  allocations,
  sectors,
  zones,
  assignments,
  officers,
  calendar,
  canManage,
  canBroadcast,
}: DutyConsoleProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [broadcastTarget, setBroadcastTarget] = useState<BroadcastTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const now = new Date();

  const createThisMonth = () => {
    setError(null);
    startTransition(async () => {
      const previous = allocations[0]; // most recent, backend sorts desc
      const result = await createDutyAllocationAction({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        // Carry last month's postings forward. A month's sheet is last
        // month's sheet amended, never 153 rows retyped.
        copyFromAllocationId: previous?.id,
      });
      if (result.error) setError(result.error);
    });
  };

  const publish = () => {
    if (!allocation) return;
    setError(null);
    startTransition(async () => {
      const result = await publishDutyAllocationAction(allocation.id);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg bg-county-red/10 border border-county-red/30 p-3 text-xs font-semibold text-county-red">
          {error}
        </div>
      )}

      {/* Allocation header — the signed sheet's cover details. */}
      <div className="card p-5">
        {allocation ? (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <FileText size={15} strokeWidth={2} className="text-county-ink/50" />
                <h2 className="font-black text-base text-county-black">
                  {MONTHS[allocation.month - 1]} {allocation.year} duty allocation
                </h2>
                <span
                  className={`badge text-[10px] font-extrabold ${
                    allocation.status === "PUBLISHED"
                      ? "bg-county-green/10 text-county-green"
                      : "bg-county-yellow/20 text-county-yellow-dark"
                  }`}
                >
                  {allocation.status}
                </span>
              </div>
              <p className="text-[11px] text-black/50 mt-1">
                {allocation.referenceNo ? `Ref ${allocation.referenceNo} · ` : ""}
                {allocation.assignmentCount} posting{allocation.assignmentCount === 1 ? "" : "s"}
                {" · "}
                {allocation.maleOnDuty} male, {allocation.femaleOnDuty} female
                {" · "}
                total {allocation.totalAssigned}
                {allocation.publishedByName ? ` · published by ${allocation.publishedByName}` : ""}
              </p>
            </div>

            {canManage && allocation.status === "DRAFT" && (
              <button
                type="button"
                onClick={publish}
                disabled={isPending}
                className="btn-primary !py-2.5 !px-5 text-xs font-bold flex items-center gap-1.5"
              >
                <CheckCircle2 size={14} strokeWidth={2} />
                {isPending ? "Publishing…" : "Publish & notify officers"}
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-black text-base text-county-black">
                No allocation for {MONTHS[now.getMonth()]} {now.getFullYear()}
              </h2>
              <p className="text-[11px] text-black/50 mt-1">
                Create this month&apos;s sheet to start posting officers.
                {allocations.length > 0 && " Last month's postings are carried over automatically."}
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={createThisMonth}
                disabled={isPending}
                className="btn-primary !py-2.5 !px-5 text-xs font-bold flex items-center gap-1.5"
              >
                <CalendarDays size={14} strokeWidth={2} />
                {isPending ? "Creating…" : "Create this month's allocation"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <DutyCalendar
            calendar={calendar}
            selectedDate={selectedDate}
            onSelectDate={(date) => setSelectedDate(date === selectedDate ? null : date)}
          />
          <SectorZoneBrowser
            sectors={sectors}
            zones={zones}
            assignments={assignments}
            selectedDate={selectedDate}
            canBroadcast={canBroadcast}
            onBroadcast={(target) => setBroadcastTarget(target)}
          />
          <DutyMap sectors={sectors} zones={zones} />
        </div>

        <div className="space-y-5">
          {canBroadcast && (
            <BroadcastComposer
              sectors={sectors}
              zones={zones}
              officers={officers}
              presetTarget={broadcastTarget}
              onClearPreset={() => setBroadcastTarget(null)}
            />
          )}
          {canManage && allocation && allocation.status !== "ARCHIVED" && (
            <PostOfficerForm
              allocationId={allocation.id}
              officers={officers}
              sectors={sectors}
              zones={zones}
            />
          )}
        </div>
      </div>

      <OfficerRosterTable officers={officers} canEdit={canManage} />
    </div>
  );
}
