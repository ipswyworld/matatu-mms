"use client";

import { useState } from "react";
import { AlertOctagon, PowerOff, Megaphone } from "lucide-react";
import type { SystemControls } from "@/lib/types";
import {
  revokeAllSessionsAction,
  setKillSwitchAction,
  setMaintenanceModeAction,
  setMaintenanceAnnouncementAction,
} from "@/lib/actions";
import ActionButton from "./ActionButton";

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Critical-tier incident levers (Ops Console Rebuild Spec §21.3).
 *
 * Visually separated from ordinary config because these are not settings —
 * they take capabilities, or the whole system, out of service. Each one
 * requires a typed confirmation, a reason, and a password re-check.
 */
export default function SystemControlsPanel({ controls }: { controls: SystemControls }) {
  const { maintenance, killSwitches, announcement } = controls;
  const [scope, setScope] = useState(maintenance.scope);
  const [message, setMessage] = useState("");
  const [announceStart, setAnnounceStart] = useState(toLocalInputValue(announcement?.scheduledStart ?? null));
  const [announceEnd, setAnnounceEnd] = useState(toLocalInputValue(announcement?.scheduledEnd ?? null));
  const [announceMessage, setAnnounceMessage] = useState(announcement?.message || "");

  const engaged = killSwitches.filter((k) => k.killed).length;

  return (
    <div className="card p-5 space-y-5 border-county-red/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-county-red flex items-center gap-1.5">
            <AlertOctagon size={14} />
            Incident Controls
          </h3>
          <p className="text-xs text-black/50 mt-0.5">
            Critical-tier levers for shedding load or taking the system out of service. Each one asks for a typed
            confirmation, a reason, and your password.
          </p>
        </div>
        {(maintenance.enabled || engaged > 0) && (
          <span className="badge text-[10px] font-extrabold bg-county-red/10 text-county-red shrink-0">
            {maintenance.enabled ? "MAINTENANCE ACTIVE" : `${engaged} SWITCH${engaged === 1 ? "" : "ES"} ENGAGED`}
          </span>
        )}
      </div>

      {/* Maintenance mode */}
      <div
        className={`rounded-lg border p-4 space-y-3 ${
          maintenance.enabled ? "border-county-red/40 bg-county-red/5" : "border-black/10 bg-black/[0.01]"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <PowerOff size={13} className={maintenance.enabled ? "text-county-red" : "text-black/40"} />
              <span className="text-xs font-bold text-county-ink">Maintenance mode</span>
              <span
                className={`badge text-[9px] font-extrabold ${
                  maintenance.enabled ? "bg-county-red/10 text-county-red" : "bg-county-green/10 text-county-green"
                }`}
              >
                {maintenance.enabled ? `ACTIVE · ${maintenance.scope.toUpperCase()}` : "OFF"}
              </span>
            </div>
            <p className="text-[11px] text-black/55 mt-1 max-w-xl">
              Scope <span className="font-semibold">public</span> leaves staff endpoints reachable so the people
              handling the incident can keep working. Scope <span className="font-semibold">all</span> is a full
              stop. The ops control plane is always exempt, so this can always be turned back off.
            </p>
          </div>
        </div>

        {maintenance.enabled ? (
          <ActionButton
            actionId="maintenance.disable"
            target="maintenance mode"
            onConfirm={(reason, token) => setMaintenanceModeAction(false, maintenance.scope, null, reason, token)}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-county-green text-white hover:bg-county-green-dark"
          >
            Disable maintenance mode
          </ActionButton>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor="maint-scope">
                Scope
              </label>
              <select
                id="maint-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="input !py-1.5 text-xs w-32"
              >
                {maintenance.scopes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="label" htmlFor="maint-msg">
                Message shown to users (optional)
              </label>
              <input
                id="maint-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={maintenance.message}
                className="input !py-1.5 text-xs"
              />
            </div>
            <ActionButton
              actionId="maintenance.enable"
              target="maintenance mode"
              onConfirm={(reason, token) => setMaintenanceModeAction(true, scope, message || null, reason, token)}
              preview={
                <span className="text-black/60">
                  Scope <span className="font-bold">{scope}</span>
                  {scope === "all" ? " — staff will be locked out too." : " — staff endpoints stay reachable."}
                </span>
              }
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-county-red text-white hover:bg-county-red/90"
            >
              Enable maintenance mode
            </ActionButton>
          </div>
        )}
      </div>

      {/* Maintenance-window announcement — never touches maintenance mode
          itself, only what the public status page and passenger-app
          banner say. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Megaphone size={13} className="text-amber-700" />
          <span className="text-xs font-bold text-county-ink">Maintenance announcement</span>
          {announcement && <span className="badge text-[9px] font-extrabold bg-amber-100 text-amber-800">SET</span>}
        </div>
        <p className="text-[11px] text-black/55 max-w-xl">
          Shown on the public status page and as a banner across the passenger app. Doesn&apos;t take the system down —
          set this ahead of a planned window, or leave both times blank to clear it.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label text-[10px]">Starts</label>
            <input type="datetime-local" value={announceStart} onChange={(e) => setAnnounceStart(e.target.value)} className="input !py-1.5 text-xs" />
          </div>
          <div>
            <label className="label text-[10px]">Ends</label>
            <input type="datetime-local" value={announceEnd} onChange={(e) => setAnnounceEnd(e.target.value)} className="input !py-1.5 text-xs" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="label text-[10px]">Message (optional)</label>
            <input value={announceMessage} onChange={(e) => setAnnounceMessage(e.target.value)} placeholder="What's happening" className="input !py-1.5 text-xs" />
          </div>
          <ActionButton
            actionId="maintenance.announce"
            target="maintenance announcement"
            onConfirm={(reason) =>
              setMaintenanceAnnouncementAction(
                announceStart ? new Date(announceStart).toISOString() : null,
                announceEnd ? new Date(announceEnd).toISOString() : null,
                announceMessage || null,
                reason,
              )
            }
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100"
          >
            {announceStart || announceEnd ? "Save announcement" : "Clear announcement"}
          </ActionButton>
        </div>
      </div>

      {/* Kill switches */}
      <div className="space-y-2.5">
        <div>
          <h4 className="text-xs font-bold text-county-ink">Kill switches</h4>
          <p className="text-[11px] text-black/50 mt-0.5">
            Load-shedding levers, not feature flags: each turns one expensive capability off for every user.
          </p>
        </div>
        {killSwitches.map((k) => (
          <div
            key={k.feature}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${
              k.killed ? "border-county-red/30 bg-county-red/5" : "border-black/10 bg-black/[0.01]"
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold text-county-green">{k.feature}</span>
                {k.killed && (
                  <span className="badge text-[9px] font-extrabold bg-county-red/10 text-county-red">DISABLED</span>
                )}
              </div>
              <p className="text-[11px] text-black/55 mt-0.5">{k.description}</p>
            </div>
            <ActionButton
              actionId="killSwitch.toggle"
              target={k.feature}
              onConfirm={(reason, token) => setKillSwitchAction(k.feature, !k.killed, reason, token)}
              preview={
                <span className="text-black/60">
                  {k.killed ? "This will restore the capability." : "This will disable the capability for all users."}
                </span>
              }
              className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border shrink-0 ${
                k.killed
                  ? "border-county-green/30 text-county-green hover:bg-county-green/5"
                  : "border-county-red/30 text-county-red hover:bg-county-red/5"
              }`}
            >
              {k.killed ? "Restore" : "Disable"}
            </ActionButton>
          </div>
        ))}
      </div>

      {/* Revoke all sessions */}
      <div className="rounded-lg border border-county-red/30 bg-county-red/5 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-bold text-county-ink">Revoke every session</span>
          <p className="text-[11px] text-black/55 mt-0.5 max-w-xl">
            Signs out every account in the system. Your own session goes too — exempting it would leave one live
            session behind during a compromise response, and would defeat the action entirely if your account is the
            compromised one.
          </p>
        </div>
        <ActionButton
          actionId="sessions.revokeAll"
          target="all sessions"
          onConfirm={(reason, token) => revokeAllSessionsAction(reason, token)}
          className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-county-red text-white hover:bg-county-red/90 shrink-0"
        >
          Revoke all sessions
        </ActionButton>
      </div>
    </div>
  );
}
