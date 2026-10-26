import type ExcelJS from "exceljs";
import { toNumber, type Table } from "./table";

export interface ExportOptions {
  splitBy: number | null; // column index
  summary: boolean;
  sourceColumns: boolean;
  numbers: number[]; // columns to store as numbers
}

export interface Dataset extends Table {
  files: string[]; // file name per row
}

function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Sheet";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 26)} ${n}`;
  used.add(name.toLowerCase());
  return name;
}

function tableRows(d: Dataset, idx: number[], o: ExportOptions): (string | number)[][] {
  return idx.map((i) => {
    const row: (string | number)[] = d.rows[i].map((v, c) => (o.numbers.includes(c) ? (toNumber(v) ?? v) : v));
    if (o.sourceColumns) row.push(d.files[i], d.source[i].page);
    return row;
  });
}

function addTableSheet(wb: ExcelJS.Workbook, name: string, headers: string[], rows: (string | number)[][], o: ExportOptions) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  styleSheet(ws, headers, rows, o.numbers);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function styleSheet(ws: ExcelJS.Worksheet, headers: string[], rows: (string | number)[][], numeric: number[]) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
  head.alignment = { vertical: "middle" };
  head.height = 20;
  headers.forEach((h, c) => {
    const longest = Math.max(h.length, ...rows.slice(0, 500).map((r) => String(r[c] ?? "").length));
    ws.getColumn(c + 1).width = Math.min(48, Math.max(8, longest + 3));
    if (numeric.includes(c)) {
      const money = rows.some((r) => typeof r[c] === "number" && !Number.isInteger(r[c]));
      ws.getColumn(c + 1).numFmt = money ? "#,##0.00" : "#,##0";
    }
  });
}

export async function buildWorkbook(d: Dataset, o: ExportOptions): Promise<Blob> {
  // Loaded on demand: the Excel writer is the heaviest part of the app.
  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  wb.creator = "PDF to Excel Extractor";
  const headers = o.sourceColumns ? [...d.headers, "Source file", "Page"] : d.headers;
  const all = d.rows.map((_, i) => i);
  const used = new Set<string>();

  if (o.summary && o.splitBy !== null) addSummary(wb, d, o, used);
  addTableSheet(wb, sheetName("All records", used), headers, tableRows(d, all, o), o);

  if (o.splitBy !== null) {
    const col = o.splitBy;
    for (const [value, idx] of groups(d, col)) {
      addTableSheet(wb, sheetName(value || "(blank)", used), headers, tableRows(d, idx, o), o);
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function groups(d: Table, col: number): [string, number[]][] {
  const m = new Map<string, number[]>();
  d.rows.forEach((r, i) => m.set(r[col], [...(m.get(r[col]) ?? []), i]));
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function addSummary(wb: ExcelJS.Workbook, d: Dataset, o: ExportOptions, used: Set<string>) {
  const col = o.splitBy!;
  // Totals only make sense for quantities and amounts, not for prices or rates.
  const sums = o.numbers.filter((c) => c !== col && !/price|rate|unit|percent|%|avg|average/i.test(d.headers[c]));
  const headers = [d.headers[col], "Records", ...sums.map((c) => (/^total\b/i.test(d.headers[c]) ? d.headers[c] : `Total ${d.headers[c]}`))];
  const rows: (string | number)[][] = groups(d, col).map(([value, idx]) => [
    value || "(blank)",
    idx.length,
    ...sums.map((c) => round(idx.reduce((s, i) => s + (toNumber(d.rows[i][c]) ?? 0), 0))),
  ]);
  const total: (string | number)[] = ["Total", d.rows.length, ...sums.map((_, k) => round(rows.reduce((s, r) => s + (r[k + 2] as number), 0)))];

  const ws = wb.addWorksheet(sheetName("Summary", used), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  const t = ws.addRow(total);
  t.font = { bold: true };
  t.border = { top: { style: "thin" } };
  styleSheet(ws, headers, [...rows, total], headers.map((_, i) => i).slice(1));
}

const round = (n: number) => Math.round(n * 100) / 100;

export function buildCsv(d: Dataset, o: ExportOptions): Blob {
  const headers = o.sourceColumns ? [...d.headers, "Source file", "Page"] : d.headers;
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...tableRows(d, d.rows.map((_, i) => i), o)].map((r) => r.map(esc).join(","));
  // BOM so Excel opens UTF-8 (Turkish, accented names) correctly.
  return new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
}
