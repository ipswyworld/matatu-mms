"use client";

import { useRef, useState, useTransition } from "react";
import { bulkImportVehiclesAction } from "@/lib/actions";

interface RowError {
  row: number;
  regNumber?: string;
  missingFields: string[];
  message: string;
}

export default function BulkImportVehiclesModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; totalRows?: number; errors: RowError[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a CSV, Excel, or PDF file first.");
      return;
    }
    setError(null);
    setResult(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const res = await bulkImportVehiclesAction(formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult({ created: res.created || 0, totalRows: res.totalRows, errors: res.errors || [] });
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="btn-secondary font-bold shadow-sm">
        ⇪ Bulk Import Vehicles
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-extrabold text-base text-county-black">Bulk Import Vehicles</h3>
                <p className="text-xs text-black/50">
                  Upload a CSV, Excel (.xlsx), or table-based PDF you already have. We&apos;ll match plate number,
                  route, capacity, driver and conductor columns automatically and flag anything missing.
                </p>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-black/40 hover:text-black font-bold text-lg">
                ✕
              </button>
            </div>

            <div className="text-[11px] text-black/50 bg-black/[0.02] border border-black/10 rounded-lg p-2.5">
              Required columns: Plate Number, Route (ID or code), Capacity, Driver Name, Driver License, Driver Phone,
              Conductor Name, Conductor License, Conductor Phone. Column names are matched flexibly (e.g. &quot;Reg
              Number&quot;, &quot;Number Plate&quot;, and &quot;Plate No&quot; all work).
            </div>

            {error && (
              <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
                {error}
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xlsm,.pdf"
                className="flex-1 text-xs file:mr-2 file:rounded file:border-0 file:bg-black/5 file:px-3 file:py-1.5 file:text-xs file:font-bold"
              />
              <button onClick={handleUpload} disabled={isPending} className="btn-primary !py-2 text-xs font-bold shrink-0">
                {isPending ? "Importing..." : "Import"}
              </button>
            </div>

            {result && (
              <div className="space-y-3 pt-2 border-t border-black/5">
                <div className="flex gap-2">
                  <span className="badge bg-county-green/10 text-county-green font-bold">{result.created} vehicles created</span>
                  {result.errors.length > 0 && (
                    <span className="badge bg-county-red/10 text-county-red font-bold">{result.errors.length} rows need fixing</span>
                  )}
                </div>
                {result.errors.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {result.errors.map((e) => (
                      <div key={e.row} className="p-2 rounded border border-county-red/20 bg-county-red/[0.03] text-[11px]">
                        <span className="font-bold text-county-black">Row {e.row}{e.regNumber ? ` (${e.regNumber})` : ""}:</span>{" "}
                        <span className="text-county-red">{e.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
