interface LiveIndicatorProps {
  label: string;
  state?: "live" | "connecting" | "offline";
  className?: string;
}

const DOT_COLOR: Record<NonNullable<LiveIndicatorProps["state"]>, string> = {
  live: "bg-county-green",
  connecting: "bg-county-yellow",
  offline: "bg-county-red",
};

/**
 * The cross-dashboard "this is happening right now" signal. Same pattern on
 * GisMap, crew GPS toggle, and any future live surface — see DESIGN.md's
 * Live/Real-Time Indicator component.
 */
export default function LiveIndicator({ label, state = "live", className = "" }: LiveIndicatorProps) {
  return (
    <div className={`inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide ${className}`}>
      <span className="relative flex h-2.5 w-2.5">
        {state !== "offline" && (
          <span
            className={`motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${DOT_COLOR[state]}`}
          />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${DOT_COLOR[state]}`} />
      </span>
      <span>{label}</span>
    </div>
  );
}
