import { ActivityLog, AuditLog, PassengerReport } from "@/lib/types";

interface ActivityFeedProps {
  auditLogs: AuditLog[];
  reports: PassengerReport[];
  activity: ActivityLog[];
  isVisible: boolean;
}

interface FeedItem {
  id: string;
  when: string;
  kind: "audit" | "report" | "activity";
  title: string;
  detail: string;
  toneColor: string;
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Created",
  STATUS_CHANGE: "Status changed",
  RENEWAL_SUBMITTED: "License renewal submitted",
  RENEWAL_DECIDED: "License renewal decided",
};

const RESOURCE_LABELS: Record<string, string> = {
  fine: "Fine",
  matatu: "Matatu",
  booking: "Booking",
  sacco_license: "Operator license",
};

function fromAudit(log: AuditLog): FeedItem {
  const action = ACTION_LABELS[log.action] || log.action;
  const resource = RESOURCE_LABELS[log.resourceType] || log.resourceType;
  return {
    id: `audit-${log.id}`,
    when: log.timestamp,
    kind: "audit",
    title: `${resource} · ${action}`,
    detail: log.resourceId,
    toneColor: "bg-county-green",
  };
}

function fromReport(r: PassengerReport): FeedItem {
  return {
    id: `report-${r.id}`,
    when: r.createdAt,
    kind: "report",
    title: `Passenger complaint · ${r.category}`,
    detail: r.matatuRegNumber || "No vehicle attached",
    toneColor: r.status === "PENDING" ? "bg-county-yellow" : "bg-county-ink/30",
  };
}

function fromActivity(a: ActivityLog): FeedItem {
  return {
    id: `activity-${a.id}`,
    when: a.timestamp,
    kind: "activity",
    title: `Field ${a.type.toLowerCase()}`,
    detail: `${a.location} · ${a.description}`,
    toneColor: a.type === "INCIDENT" ? "bg-county-red" : "bg-county-blue",
  };
}

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const s = Math.round((now - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default function ActivityFeed({ auditLogs, reports, activity, isVisible }: ActivityFeedProps) {
  if (!isVisible) {
    return (
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-county-ink/[0.06]">
        <h3 className="font-black text-county-ink text-base tracking-tight">Recent field activity</h3>
        <p className="text-[11px] text-county-ink/50 mt-1">Trips, inspections and incidents logged by crew and officers.</p>
        <ul className="mt-4 space-y-3">
          {activity.length === 0 ? (
            <li className="text-sm text-county-ink/40 py-6 text-center">No recent activity.</li>
          ) : (
            activity.slice(0, 6).map((a) => {
              const item = fromActivity(a);
              return (
                <li key={item.id} className="flex gap-3 text-sm">
                  <span className={`${item.toneColor} h-2 w-2 rounded-full mt-2 shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-county-ink text-[13px]">{item.title}</div>
                    <div className="text-xs text-county-ink/50 truncate">{item.detail}</div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-county-ink/40 mt-1">
                      {timeAgo(item.when)}
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    );
  }

  const items: FeedItem[] = [
    ...auditLogs.map(fromAudit),
    ...reports.map(fromReport),
    ...activity.map(fromActivity),
  ]
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .slice(0, 10);

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-county-ink/[0.06] flex flex-col">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">System heartbeat</h3>
          <p className="text-[11px] text-county-ink/50 mt-1">Live events across every role, in one stream.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-county-green">
          <span className="relative flex h-2 w-2">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-county-green opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-county-green" />
          </span>
          Live
        </span>
      </div>

      <ul className="mt-3 space-y-3 flex-1 max-h-[360px] overflow-y-auto pr-1">
        {items.length === 0 ? (
          <li className="text-sm text-county-ink/40 py-8 text-center">No system events yet.</li>
        ) : (
          items.map((item) => (
            <li key={item.id} className="flex gap-3 text-sm border-b border-county-ink/[0.05] pb-3 last:border-0 last:pb-0">
              <span className={`${item.toneColor} h-2 w-2 rounded-full mt-2 shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-county-ink text-[13px] leading-snug">{item.title}</div>
                <div className="text-xs text-county-ink/55 mt-0.5 line-clamp-2">{item.detail}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-county-ink/40 mt-1">
                  {timeAgo(item.when)}
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
