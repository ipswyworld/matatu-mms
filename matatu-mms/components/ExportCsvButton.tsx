"use client";

import { downloadCsv } from "@/lib/csvExport";

interface ExportCsvButtonProps {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
  label?: string;
  variant?: "dark" | "light";
}

export default function ExportCsvButton({ filename, headers, rows, label = "Export CSV", variant = "dark" }: ExportCsvButtonProps) {
  const styles =
    variant === "dark"
      ? "bg-white/10 text-white hover:bg-white/15"
      : "border border-county-ink/15 bg-white text-county-ink hover:bg-county-cream-dark";
  return (
    <button
      onClick={() => downloadCsv(filename, headers, rows)}
      disabled={rows.length === 0}
      className={`rounded-lg px-3.5 py-2 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles}`}
    >
      ⭳ {label}
    </button>
  );
}
