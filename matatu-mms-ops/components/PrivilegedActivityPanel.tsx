import { LoginOverview } from "@/lib/types";

export default function PrivilegedActivityPanel({ overview }: { overview: LoginOverview }) {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Privileged Account Activity</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Recent Admin/Super Admin sign-ins and failed-login bursts — two real signals, not a risk score.
        </p>
      </div>

      {overview.failedLoginBursts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-county-red">Failed-login bursts (last 15 min)</p>
          {overview.failedLoginBursts.map((b) => (
            <div key={b.email} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-county-red/[0.04] border border-county-red/20">
              <span className="font-mono text-xs text-county-black">{b.email}</span>
              <span className="text-[11px] font-bold text-county-red">{b.count} failed attempts · last {new Date(b.lastAttemptAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-black/40">Recent privileged sign-ins</p>
        {overview.recentPrivilegedLogins.length === 0 ? (
          <p className="text-xs text-black/40 italic">No privileged sign-ins recorded yet.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {overview.recentPrivilegedLogins.map((login) => (
              <div key={login.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-black/10 bg-black/[0.01]">
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-county-black">{login.userName}</span>
                  {login.ipAddress && <span className="ml-2 font-mono text-[10px] text-black/40">{login.ipAddress}</span>}
                  {login.isNewIp && <span className="ml-2 badge text-[9px] font-bold bg-amber-500/10 text-amber-700">NEW IP</span>}
                </div>
                <span className="text-[10px] text-black/40 shrink-0 whitespace-nowrap">{new Date(login.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
