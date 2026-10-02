import MatatuGlyph from "./MatatuGlyph";

interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}

/**
 * Shared empty state — one of the named slots where a matatu livery accent
 * is allowed (see DESIGN.md). Not used on data tables or forms.
 */
export default function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="h-16 w-20 flex items-center justify-center rounded-2xl bg-county-black/[0.03] text-county-black/25">
        <MatatuGlyph size={44} />
      </div>
      <div>
        <p className="text-sm font-semibold text-county-black/70">{title}</p>
        {hint && <p className="text-xs text-black/40 mt-1 max-w-xs">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
