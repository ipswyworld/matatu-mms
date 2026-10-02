/**
 * Git-diff-styled before/after preview for an ActionButton's `preview` slot
 * (Ops Console Rebuild Spec's Phase 5 item). ActionButton already had the
 * extension point — this just gives config panels with a real old→new
 * value pair (currently: rate limits) something better than plain text to
 * put in it.
 */
export default function ConfigDiff({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="rounded-lg border border-black/10 overflow-hidden font-mono text-[11px]">
      <div className="px-2.5 py-1 bg-black/[0.03] text-black/40 text-[10px] font-bold uppercase tracking-wide">{label}</div>
      <div className="px-2.5 py-1 bg-county-red/[0.06] text-county-red flex gap-1.5">
        <span className="select-none">-</span>
        <span className="break-all">{from}</span>
      </div>
      <div className="px-2.5 py-1 bg-county-green/[0.06] text-county-green flex gap-1.5">
        <span className="select-none">+</span>
        <span className="break-all">{to}</span>
      </div>
    </div>
  );
}
