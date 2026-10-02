"use client";

/**
 * Client-side export — builds the file from data already on the page, no
 * backend round-trip. Three formats behind one shared (headers, rows) shape
 * so every call site (fines ledger, audit trail, crime ledger) gets all
 * three for free.
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

export async function downloadPdf(filename: string, headers: string[], rows: (string | number)[][], title?: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: rows.length && headers.length > 6 ? "landscape" : "portrait" });
  if (title) {
    doc.setFontSize(14);
    doc.setTextColor(18, 24, 36); // county-black
    doc.text(title, 14, 15);
  }
  autoTable(doc, {
    head: [headers],
    body: rows.map((row) => row.map((cell) => String(cell))),
    startY: title ? 20 : 12,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [6, 137, 48] }, // county-green
    margin: { left: 10, right: 10 },
  });
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
