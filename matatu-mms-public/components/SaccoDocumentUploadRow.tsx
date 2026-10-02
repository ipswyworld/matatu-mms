"use client";

import { useRef, useState, useTransition } from "react";
import { uploadSaccoDocumentAction } from "@/lib/actions";
import { SaccoDocType } from "@/lib/types";

// Browser-side link — behind nginx this is same-origin so an empty string
// (relative path) is correct; in local dev without nginx it needs the
// backend's own origin.
const PUBLIC_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";

export default function SaccoDocumentUploadRow({
  saccoId,
  docType,
  label,
  currentPath,
  required = true,
}: {
  saccoId: string;
  docType: SaccoDocType;
  label: string;
  currentPath?: string;
  required?: boolean;
}) {
  const [path, setPath] = useState(currentPath);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadSaccoDocumentAction(saccoId, docType, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPath(`${file.name} (uploaded)`);
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <div className="p-2.5 rounded-lg border border-black/10 bg-black/[0.01] flex flex-wrap justify-between items-center gap-2 text-xs">
      <div className="min-w-0">
        <div className="font-bold text-county-black">
          {label} {!required && <span className="font-normal text-black/40">(optional)</span>}
        </div>
        <div className="text-[10px] text-black/50 font-mono truncate max-w-[220px]">
          {path ? (
            path.startsWith("/uploads/") ? (
              <a href={`${PUBLIC_BACKEND_URL}${path}`} target="_blank" className="text-county-blue hover:underline">
                View uploaded file
              </a>
            ) : (
              path
            )
          ) : (
            "Not yet uploaded"
          )}
        </div>
        {error && <div className="text-county-red font-semibold mt-1">{error}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="text-[10px] w-36 file:mr-1.5 file:rounded file:border-0 file:bg-black/5 file:px-2 file:py-1 file:text-[10px] file:font-bold"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={isPending}
          className="btn-secondary !py-1 !px-2.5 text-[10px] font-bold shrink-0"
        >
          {isPending ? "Uploading..." : path ? "Replace" : "Upload"}
        </button>
        {path ? (
          <span className="badge bg-county-green/10 text-county-green font-bold shrink-0">UPLOADED</span>
        ) : (
          <span className="badge bg-county-yellow/20 text-yellow-800 font-bold shrink-0">MISSING</span>
        )}
      </div>
    </div>
  );
}
