import { WidgetConfig } from "@/lib/widgets";
import KpiCard from "@/components/dashboard/KpiCard";
import FinesTrendChart from "@/components/dashboard/FinesTrendChart";

/**
 * Renders a WidgetConfig[] (lib/widgets.ts) as a responsive grid — the
 * "compose dashboards from a widget library" half of §25.1. Each widget
 * type dispatches to its real component; adding a widget type here is the
 * only change needed to make it available to every role's template.
 */
export default function WidgetGrid({ widgets }: { widgets: WidgetConfig[] }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
      {widgets.map((widget) => {
        switch (widget.type) {
          case "kpi":
            return (
              <KpiCard
                key={widget.key}
                label={widget.label}
                value={widget.value}
                accent={widget.accent}
                href={widget.href}
              />
            );
          case "trend":
            // FinesTrendChart is currently hardcoded to the "fines" metric
            // (Task 19) — a generic TrendChart accepting `metric` as a prop
            // is the natural next step once a second trend widget
            // (bookings) is actually needed on a real dashboard.
            return (
              <div key={widget.key} className="sm:col-span-2">
                <FinesTrendChart />
              </div>
            );
          case "table":
            return (
              <div key={widget.key} className="sm:col-span-2 lg:col-span-3 rounded-2xl bg-white p-4 md:p-5 shadow-sm ring-1 ring-county-ink/[0.06]">
                <h3 className="font-black text-county-ink text-base tracking-tight mb-3">{widget.title}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-county-ink/5 text-county-ink/60 uppercase text-[10px]">
                      <tr>
                        {widget.columns.map((col) => (
                          <th key={col} className="p-2.5">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-county-ink/5">
                      {widget.rows.map((row, i) => (
                        <tr key={i}>
                          {widget.columns.map((col) => (
                            <td key={col} className="p-2.5">{row[col]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
