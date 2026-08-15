"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FineStatusPill } from "./StatusPill";
import ExportCsvButton from "./ExportCsvButton";
import { disputeFineAction, markFinePaidAction, waiveFineAction } from "@/lib/actions";
import { Fine, Matatu, Sacco } from "@/lib/types";

interface FinesFilterTableProps {
  fines: Fine[];
  matatus: Matatu[];
  saccos: Sacco[];
  isSacco: boolean;
  canUpdate: boolean;
  canDispute: boolean;
}

export default function FinesFilterTable({ fines, matatus, saccos, isSacco, canUpdate, canDispute }: FinesFilterTableProps) {
  const [status, setStatus] = useState("");
  const [saccoId, setSaccoId] = useState("");

  const matatuMap = useMemo(() => new Map(matatus.map((m) => [m.id, m])), [matatus]);

  const filtered = useMemo(() => {
    return fines
      .filter((f) => {
        const m = matatuMap.get(f.matatuId);
        if (!m) return false;
        const matchesSacco = isSacco || !saccoId || m.saccoId === saccoId;
        const matchesStatus = !status || f.status === status;
        return matchesSacco && matchesStatus;
      })
      .slice()
      .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
  }, [fines, matatuMap, isSacco, saccoId, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-end bg-black/5 p-4 rounded-lg">
        <div className="w-56 shrink-0">
          <label className="text-xs font-semibold text-black/50 block mb-1">Filter by Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full text-sm border border-black/10 rounded px-3 py-1.5 focus:outline-none focus:border-county-green bg-white"
          >
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="PAID">Paid</option>
            <option value="DISPUTED">Disputed</option>
            <option value="WAIVED">Waived</option>
          </select>
        </div>

        {!isSacco && (
          <div className="w-56 shrink-0">
            <label className="text-xs font-semibold text-black/50 block mb-1">Filter by Operator</label>
            <select
              value={saccoId}
              onChange={(e) => setSaccoId(e.target.value)}
              className="w-full text-sm border border-black/10 rounded px-3 py-1.5 focus:outline-none focus:border-county-green bg-white"
            >
              <option value="">All Operators</option>
              {saccos.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {(status || saccoId) && (
          <button
            type="button"
            onClick={() => {
              setStatus("");
              setSaccoId("");
            }}
            className="btn-secondary !py-1.5 shrink-0"
          >
            Clear
          </button>
        )}

        <span className="text-xs font-semibold text-black/40 self-center">
          {filtered.length} of {fines.length}
        </span>

        <div className="ml-auto">
          <ExportCsvButton
            variant="light"
            filename="fines-ledger"
            headers={["Vehicle", "Reason", "Amount (KES)", "Issued", "Due", "Status"]}
            rows={filtered.map((f) => [
              matatuMap.get(f.matatuId)?.regNumber || "Unknown",
              f.reason,
              f.amountKes,
              f.issuedAt,
              f.dueDate,
              f.status,
            ])}
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Reason</th>
              <th>Amount</th>
              <th>Issued</th>
              <th>Due</th>
              <th>Status</th>
              {(canUpdate || canDispute) && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => {
              const m = matatuMap.get(f.matatuId);
              return (
                <tr key={f.id}>
                  <td>
                    <Link href={`/matatus/${f.matatuId}`} className="font-semibold text-county-green hover:underline">
                      {m?.regNumber || "Unknown"}
                    </Link>
                  </td>
                  <td>{f.reason}</td>
                  <td className="font-semibold">KES {f.amountKes.toLocaleString()}</td>
                  <td>{new Date(f.issuedAt).toLocaleDateString()}</td>
                  <td>{f.dueDate}</td>
                  <td><FineStatusPill status={f.status} /></td>
                  {(canUpdate || canDispute) && (
                    <td>
                      <div className="flex gap-2 flex-wrap">
                        {canUpdate && f.status === "PENDING" && (
                          <form action={markFinePaidAction.bind(null, f.id)}>
                            <button className="btn-secondary !px-2 !py-1 text-xs" type="submit">Mark paid</button>
                          </form>
                        )}
                        {canUpdate && f.status !== "WAIVED" && f.status !== "PAID" && (
                          <form action={waiveFineAction.bind(null, f.id)}>
                            <button className="btn-secondary !px-2 !py-1 text-xs" type="submit">Waive</button>
                          </form>
                        )}
                        {canDispute && f.status === "PENDING" && (
                          <form action={disputeFineAction.bind(null, f.id)}>
                            <button className="btn-danger !px-2 !py-1 text-xs" type="submit">Dispute</button>
                          </form>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center text-black/40 py-8">No citations matching search criteria.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
