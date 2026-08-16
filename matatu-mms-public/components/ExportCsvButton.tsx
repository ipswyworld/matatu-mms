"use client";

import { useEffect, useRef, useState } from "react";
import { downloadCsv, downloadExcel, downloadPdf } from "@/lib/csvExport";

interface ExportCsvButtonProps {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
  title?: string; // used as the PDF's printed heading
  label?: string;
  variant?: "dark" | "light";
}

const FORMATS = [
  { id: "csv", label: "CSV", hint: "Spreadsheet-friendly, opens anywhere" },
  { id: "excel", label: "Excel", hint: "Formatted .xls workbook" },
  { id: "pdf", label: "PDF", hint: "Printable report" },
] as const;

export default function ExportCsvButton({ filename, headers, rows, title, label = "Export", variant = "dark" }: ExportCsvButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  };

  const styles =
    variant === "dark"
      ? "bg-white/10 text-white hover:bg-white/15"
      : "border border-county-ink/15 bg-white text-county-ink hover:bg-county-cream-dark";

  const handlePick = async (format: (typeof FORMATS)[number]["id"]) => {
    setBusy(true);
    try {
      if (format === "csv") downloadCsv(filename, headers, rows);
      else if (format === "excel") downloadExcel(filename, headers, rows);
      else await downloadPdf(filename, headers, rows, title);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        disabled={rows.length === 0}
        className={`rounded-lg px-3.5 py-2 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles}`}
      >
        ⭳ {label}
      </button>

      {open && (
        <div
          className="fixed w-56 bg-white rounded-xl shadow-2xl border border-black/10 py-1.5 z-50"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-black/40">Export as</div>
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => handlePick(f.id)}
              disabled={busy}
              className="w-full text-left px-3 py-2 hover:bg-black/5 transition-colors disabled:opacity-50"
            >
              <div className="text-xs font-bold text-county-black">{f.label}</div>
              <div className="text-[10px] text-black/45">{f.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
