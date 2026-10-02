"use client";

/**
 * Client-side export — builds the file from data already on the page, no
 * backend round-trip. Ported from matatu-mms/lib/csvExport.ts (CSV + Excel
 * only, both dependency-free; that app's PDF export needs jspdf, which
 * isn't a dependency here and isn't worth adding for one button).
 */

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  const csv = lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

function escapeHtml(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Excel opens an HTML table saved with an .xls extension natively — no
 * binary spreadsheet library needed for a clean, formatted export.
 */
export function downloadExcel(filename: string, headers: string[], rows: (string | number)[][]) {
  const headerRow = headers.map((h) => `<th style="background:#068930;color:#fff;padding:6px 10px;text-align:left;">${escapeHtml(h)}</th>`).join("");
  const bodyRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><table>${`<tr>${headerRow}</tr>`}${bodyRows}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".xls") ? filename : `${filename}.xls`);
}
