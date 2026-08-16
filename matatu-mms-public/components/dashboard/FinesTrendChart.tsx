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
import { TimeseriesPoint } from "@/lib/types";
import { getTimeseriesAction } from "@/lib/actions";

const RANGE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

function formatKes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

function formatBucketLabel(bucket: string): string {
  const d = new Date(bucket);
  if (Number.isNaN(d.getTime())) return bucket;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Real Recharts-based interactive time-series chart, consuming the
 * server-pre-aggregated /api/analytics/timeseries endpoint (never raw
 * rows — ARCHITECTURE_DECISIONS.md §23.3). First chart built against this
 * pattern; the shared shape (date-range presets + Recharts + a bucketed
 * endpoint) is the template for replacing the other hand-rolled charts
 * (RevenueBarChart, ComplianceDonut) later, not done in this pass.
 */
export default function FinesTrendChart() {
  const [days, setDays] = useState<number>(30);
  const [points, setPoints] = useState<TimeseriesPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      getTimeseriesAction("fines", days, "day").then((result) => {
        setPoints(result.points as TimeseriesPoint[]);
        setError(result.error || null);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const loading = isPending && points.length === 0;

  const totalValue = points.reduce((sum, p) => sum + p.value, 0);
  const totalCount = points.reduce((sum, p) => sum + p.count, 0);

  // Narrative insight + trend-vs-baseline (ARCHITECTURE_DECISIONS.md §24.3
  // items 13-14 — a plain-language "so what" sentence, not just a bare
  // number). Compares the first half of the loaded range against the
  // second half as a simple baseline; a real "vs previous period" would
  // need the endpoint to return an adjacent comparison window too — this
  // is the honest version buildable from what /timeseries already returns.
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

  return (
    <div className="rounded-2xl bg-white p-4 md:p-5 shadow-sm ring-1 ring-county-ink/[0.06] flex flex-col">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">Fines issued over time</h3>
          <p className="text-[11px] text-county-ink/50 mt-1">
            {totalCount} fines &middot; KES {formatKes(totalValue)}
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
            No fines issued in this range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="finesTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#B4232C" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#B4232C" stopOpacity={0} />
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
                formatter={(value) => [`KES ${Number(value).toLocaleString()}`, "Amount"]}
                labelFormatter={(label) => formatBucketLabel(String(label))}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #00110A14" }}
              />
              <Area type="monotone" dataKey="value" stroke="#B4232C" strokeWidth={2} fill="url(#finesTrendFill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
