"use client";

import { useEffect, useState, useTransition } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { getTimeseriesAction } from "@/lib/actions";

const RANGE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

function formatBucketLabel(bucket: string): string {
  const d = new Date(bucket);
  if (Number.isNaN(d.getTime())) return bucket;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface TrendChartProps {
  /** Must match a metric the backend's /api/analytics/timeseries actually
   * aggregates — see backend/app/routes/analytics.py. */
  metric: "fines" | "bookings";
  title: string;
  /** Short unit noun for the count line, e.g. "fines", "bookings". */
  countUnit: string;
  /** Hex color driving the line/fill/tooltip accent. */
  color?: string;
  valueFormat?: "currency" | "number";
  /** Formats the value axis/tooltip/summary — default plain thousands. */
  valueFormatter?: (n: number) => string;
}

const defaultFormatter = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : n.toString());
const currencyFormatter = (n: number) => `KES ${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : n.toString()}`;

/**
 * Generic Recharts-backed trend widget (ADMIN_DASHBOARD_AUDIT §5.1) —
 * replaces the one-off FinesTrendChart this was extracted from. Any
 * metric the backend's /api/analytics/timeseries endpoint supports can
 * use this without a new bespoke component; adding a metric to the
 * backend union is the only step needed to wire up a new trend widget.
 */
export default function TrendChart({
  metric,
  title,
  countUnit,
  color = "#0F5132",
  valueFormat,
  valueFormatter,
}: TrendChartProps) {
  const activeFormatter = valueFormat === "currency" ? currencyFormatter : (metric === "fines" && !valueFormat && !valueFormatter ? currencyFormatter : (valueFormatter || defaultFormatter));
  const [days, setDays] = useState<number>(30);
  const [points, setPoints] = useState<{ bucket: string; count: number; value: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      getTimeseriesAction(metric, days, "day").then((result) => {
        setPoints(result.points);
        setError(result.error || null);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, metric]);

  const loading = isPending && points.length === 0;
  const totalValue = points.reduce((sum, p) => sum + p.value, 0);
  const totalCount = points.reduce((sum, p) => sum + p.count, 0);

  // Narrative insight (first half vs second half of the loaded range) —
  // same "so what" pattern the original FinesTrendChart established.
  const midpoint = Math.floor(points.length / 2);
  const firstHalfValue = points.slice(0, midpoint).reduce((sum, p) => sum + p.value, 0);
  const secondHalfValue = points.slice(midpoint).reduce((sum, p) => sum + p.value, 0);
  const percentChange = firstHalfValue > 0 ? Math.round(((secondHalfValue - firstHalfValue) / firstHalfValue) * 100) : null;
  const insight =
    percentChange === null || points.length < 4
      ? null
      : percentChange > 5
      ? `Trending up ${percentChange}% versus earlier in this range.`
      : percentChange < -5
      ? `Trending down ${Math.abs(percentChange)}% versus earlier in this range.`
      : "Holding steady across this range.";

  const gradientId = `trendFill-${metric}`;

  return (
    <div className="rounded-2xl bg-white p-4 md:p-5 shadow-sm ring-1 ring-county-ink/[0.06] flex flex-col">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">{title}</h3>
          <p className="text-[11px] text-county-ink/50 mt-1">
            {totalCount} {countUnit} &middot; {activeFormatter(totalValue)}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-county-ink/5 p-0.5">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setDays(preset.days)}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors ${
                days === preset.days ? "bg-white text-county-ink shadow-sm" : "text-county-ink/50 hover:text-county-ink"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {insight && (
        <p className="text-xs text-county-ink/70 mt-2 flex items-center gap-1.5">
          {percentChange !== null && percentChange > 5 && <span aria-hidden>↑</span>}
          {percentChange !== null && percentChange < -5 && <span aria-hidden>↓</span>}
          {insight}
        </p>
      )}

      <div className="mt-3 h-[180px]">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-county-ink/40">Loading…</div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-xs text-county-red">{error}</div>
        ) : points.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-county-ink/40">
            No {countUnit} in this range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#00110A0F" />
              <XAxis
                dataKey="bucket"
                tickFormatter={formatBucketLabel}
                tick={{ fontSize: 10, fill: "#00110A80" }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis tick={{ fontSize: 10, fill: "#00110A80" }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                formatter={(value) => [activeFormatter(Number(value)), "Amount"]}
                labelFormatter={(label) => formatBucketLabel(String(label))}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #00110A14" }}
              />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
