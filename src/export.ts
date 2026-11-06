import type ExcelJS from "exceljs";
import { numberIn, PER_UNIT, type ColumnKind, type Table } from "./table.ts";
import { toDate } from "./values.ts";
import { tKnown } from "./i18n.ts";

export interface ExportOptions {
  splitBy: number | null; // column index
  summary: boolean;
  sourceColumns: boolean;
  kinds: ColumnKind[]; // how each column is stored: numbers, percentages and dates as real values
}

type Cell = string | number | Date;

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

/** A cell as Excel should hold it: amounts as numbers, 12.5% as 0.125, dates as dates. */
function cellValue(k: ColumnKind | undefined, v: string): Cell {
  if (!k || !v) return v;
  if (k.kind === "number") return numberIn(k, v) ?? v;
  if (k.kind === "percent") {
    const n = numberIn(k, v);
    return n === null ? v : n / 100;
  }
  if (k.kind === "date") {
    const d = toDate(v, k.order);
    return d ? new Date(Date.UTC(d[0], d[1] - 1, d[2])) : v;
  }
  return v;
}

function tableRows(d: Dataset, idx: number[], o: ExportOptions): Cell[][] {
  return idx.map((i) => {
    const row: Cell[] = d.rows[i].map((v, c) => cellValue(o.kinds[c], v));
    if (o.sourceColumns) row.push(d.files[i], d.source[i].page);
    return row;
  });
}

function addTableSheet(wb: ExcelJS.Workbook, name: string, headers: string[], rows: Cell[][], o: ExportOptions) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  styleSheet(ws, headers, rows, o.kinds.map((k) => k.kind));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function styleSheet(ws: ExcelJS.Worksheet, headers: string[], rows: Cell[][], kinds: ColumnKind["kind"][]) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
  head.alignment = { vertical: "middle" };
  head.height = 20;
  headers.forEach((h, c) => {
    const shown = (v: Cell | undefined) => (v instanceof Date ? 10 : String(v ?? "").length);
    const longest = Math.max(h.length, ...rows.slice(0, 500).map((r) => shown(r[c])));
    ws.getColumn(c + 1).width = Math.min(48, Math.max(8, longest + 3));
    const nums = rows.map((r) => r[c]).filter((v): v is number => typeof v === "number");
    if (kinds[c] === "number" && nums.length) ws.getColumn(c + 1).numFmt = nums.some((n) => !Number.isInteger(n)) ? "#,##0.00" : "#,##0";
    if (kinds[c] === "percent" && nums.length) ws.getColumn(c + 1).numFmt = nums.some((n) => !Number.isInteger(Math.round(n * 1e6) / 1e4)) ? "0.0%" : "0%";
    if (kinds[c] === "date") ws.getColumn(c + 1).numFmt = "yyyy-mm-dd";
  });
}

export async function buildWorkbook(d: Dataset, o: ExportOptions): Promise<Blob> {
  // Loaded on demand: the Excel writer is the heaviest part of the app.
  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  wb.creator = "PDF to Excel Extractor";
  const headers = o.sourceColumns ? [...d.headers, tKnown("Source file"), tKnown("Page")] : d.headers;
  const all = d.rows.map((_, i) => i);
  const used = new Set<string>();

  if (o.summary && o.splitBy !== null) addSummary(wb, d, o, used);
  addTableSheet(wb, sheetName(tKnown("All records"), used), headers, tableRows(d, all, o), o);

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
  const sums = o.kinds.map((k, c) => (k.kind === "number" && c !== col && !PER_UNIT.test(d.headers[c]) ? c : -1)).filter((c) => c >= 0);
  const headers = [d.headers[col], tKnown("Records"), ...sums.map((c) => (/^total\b/i.test(d.headers[c]) ? d.headers[c] : `${tKnown("Total")} ${d.headers[c]}`))];
  const rows: (string | number)[][] = groups(d, col).map(([value, idx]) => [
    value || "(blank)",
    idx.length,
    ...sums.map((c) => round(idx.reduce((s, i) => s + (numberIn(o.kinds[c], d.rows[i][c]) ?? 0), 0))),
  ]);
  const total: (string | number)[] = [tKnown("Total"), d.rows.length, ...sums.map((_, k) => round(rows.reduce((s, r) => s + (r[k + 2] as number), 0)))];

  const ws = wb.addWorksheet(sheetName(tKnown("Summary"), used), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  const t = ws.addRow(total);
  t.font = { bold: true };
  t.border = { top: { style: "thin" } };
  styleSheet(ws, headers, [...rows, total], headers.map((_, i) => (i ? "number" : "text")));
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * CSV for the spreadsheet on this computer: where the locale writes "1,5", Excel
 * expects ";" between fields and a decimal comma. Text that starts like a formula
 * (= + - @) is prefixed with ' so a spreadsheet shows it instead of running it.
 */
export function buildCsv(d: Dataset, o: ExportOptions, locale = "en-US"): Blob {
  const comma = (1.5).toLocaleString(locale).includes(",");
  const sep = comma ? ";" : ",";
  const headers = o.sourceColumns ? [...d.headers, tKnown("Source file"), tKnown("Page")] : d.headers;
  const text = (v: Cell) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "number") return comma ? String(v).replace(".", ",") : String(v);
    return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  };
  const esc = (v: Cell) => {
    const s = text(v);
    return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...tableRows(d, d.rows.map((_, i) => i), o)].map((r) => r.map(esc).join(sep));
  // BOM so Excel opens UTF-8 (Turkish, accented names) correctly.
  return new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
}
