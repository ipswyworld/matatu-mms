"use client";

import { useState, useTransition } from "react";
import { SupportTicket, User } from "@/lib/types";
import { createSupportTicketAction, updateSupportTicketAction, CreateSupportTicketInput } from "@/lib/actions";

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-800",
  IN_PROGRESS: "bg-county-blue/10 text-county-blue",
  RESOLVED: "bg-county-green/10 text-county-green",
  CLOSED: "bg-black/10 text-black/50",
};

const PRIORITY_STYLE: Record<string, string> = {
  LOW: "text-black/40",
  MEDIUM: "text-black/60",
  HIGH: "text-amber-700 font-bold",
  URGENT: "text-county-red font-bold",
};

function TicketRow({ ticket, staff }: { ticket: SupportTicket; staff: User[] }) {
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [assigneeId, setAssigneeId] = useState(ticket.assigneeId || "");
  const [isPending, startTransition] = useTransition();

  function save(update: Partial<{ status: string; priority: string; assigneeId: string | null }>) {
    startTransition(async () => {
      await updateSupportTicketAction(ticket.id, update);
    });
  }

  return (
    <tr>
      <td className="align-top">
        <span className="font-semibold text-county-black">{ticket.subject}</span>
        <p className="text-xs text-black/50 mt-0.5 max-w-md">{ticket.description}</p>
        <p className="text-[11px] text-black/35 mt-1">{ticket.reporterName} · {ticket.reporterContact}</p>
      </td>
      <td>
        <select
          value={status}
          disabled={isPending}
          onChange={(e) => { setStatus(e.target.value as SupportTicket["status"]); save({ status: e.target.value }); }}
          className={`input !py-1 !px-2 text-xs font-bold border-0 ${STATUS_STYLE[status]}`}
        >
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>
      </td>
      <td>
        <select
          value={priority}
          disabled={isPending}
          onChange={(e) => { setPriority(e.target.value as SupportTicket["priority"]); save({ priority: e.target.value }); }}
          className={`input !py-1 !px-2 text-xs border border-black/10 ${PRIORITY_STYLE[priority]}`}
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </td>
      <td>
        <select
          value={assigneeId}
          disabled={isPending}
          onChange={(e) => { setAssigneeId(e.target.value); save({ assigneeId: e.target.value || null }); }}
          className="input !py-1 !px-2 text-xs border border-black/10"
        >
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </td>
      <td className="text-[11px] text-black/40 whitespace-nowrap">{new Date(ticket.createdAt).toLocaleDateString()}</td>
    </tr>
  );
}

function NewTicketForm() {
  const [form, setForm] = useState<CreateSupportTicketInput>({ subject: "", description: "", priority: "MEDIUM", reporterName: "", reporterContact: "" });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!form.subject.trim() || !form.description.trim() || !form.reporterName.trim() || !form.reporterContact.trim()) {
      setError("Subject, description, reporter name, and contact are all required.");
      return;
    }
    startTransition(async () => {
      const result = await createSupportTicketAction(form);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setForm({ subject: "", description: "", priority: "MEDIUM", reporterName: "", reporterContact: "" });
      }
    });
  }

  return (
    <div className="card p-5 space-y-3">
      <h3 className="font-bold text-sm text-county-black">New ticket</h3>
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject" className="input text-xs" />
        <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="input text-xs">
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
        <input value={form.reporterName} onChange={(e) => setForm({ ...form, reporterName: e.target.value })} placeholder="Reporter name" className="input text-xs" />
        <input value={form.reporterContact} onChange={(e) => setForm({ ...form, reporterContact: e.target.value })} placeholder="Phone or email" className="input text-xs" />
      </div>
      <textarea
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        placeholder="What's the issue?"
        className="input text-xs min-h-[64px] w-full"
      />
      <button onClick={submit} disabled={pending} className="btn-primary text-xs px-4 py-2 disabled:opacity-50">
        {pending ? "Creating…" : "Create ticket"}
      </button>
      {error && <p className="text-xs text-county-red font-semibold">{error}</p>}
    </div>
  );
}

export default function SupportTicketsBoard({ tickets, staff }: { tickets: SupportTicket[]; staff: User[] }) {
  const [showClosed, setShowClosed] = useState(false);
  const visible = showClosed ? tickets : tickets.filter((t) => t.status !== "CLOSED" && t.status !== "RESOLVED");

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-black/[0.06]">
          <span className="text-xs font-bold text-black/50">{visible.length} ticket{visible.length !== 1 ? "s" : ""}</span>
          <label className="flex items-center gap-1.5 text-xs text-black/50">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show resolved/closed
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assignee</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <TicketRow key={t.id} ticket={t} staff={staff} />
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-black/40 py-8">No tickets to show.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <NewTicketForm />
    </div>
  );
}
