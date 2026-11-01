// The workbook and CSV as a spreadsheet will read them, built from the stress documents.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { pageText, type RawItem } from "../src/frame.ts";
import { columnKinds, extractTable, type PageText } from "../src/table.ts";
import { buildCsv, buildWorkbook, type Dataset } from "../src/export.ts";

async function dataset(name: string): Promise<Dataset> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`tests/fixtures/stress/${name}.pdf`)), verbosity: 0 }).promise;
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    pages.push(pageText(p, (await page.getTextContent()).items as RawItem[], page.getViewport({ scale: 1 })));
  }
  const t = extractTable(pages)!;
  return { ...t, files: t.rows.map(() => `${name}.pdf`) };
}

async function sheet(d: Dataset, splitBy: number | null = null) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await (await buildWorkbook(d, { splitBy, summary: splitBy !== null, sourceColumns: false, kinds: columnKinds(d) })).arrayBuffer());
  return wb;
}

// Turkish amounts become numbers that add up; the date column holds real dates.
const tr = await dataset("tr-statement");
const trWs = (await sheet(tr)).getWorksheet("All records")!;
assert.equal(typeof trWs.getCell("C2").value, "number");
assert.equal(trWs.getColumn(3).numFmt, "#,##0.00");
assert.ok(trWs.getCell("A2").value instanceof Date, "dd.mm.yyyy is a date");
assert.equal((trWs.getCell("A2").value as Date).toISOString().slice(0, 10), "2026-10-01");

// Identifiers stay text with every digit; the balance is a number.
const ids = await dataset("ids-leading-zeros");
const idWs = (await sheet(ids)).getWorksheet("All records")!;
assert.equal(idWs.getCell("A2").value, ids.rows[0][0]);
assert.match(String(idWs.getCell("A2").value), /^0/);
assert.equal(String(idWs.getCell("C2").value).length, 16);
assert.equal(typeof idWs.getCell("D2").value, "number");

// Percentages are stored as fractions with a percent format.
const fr = await dataset("fr-spaces");
const frWs = (await sheet(fr)).getWorksheet("All records")!;
assert.equal(frWs.getCell("D2").value, Math.round(Number(fr.rows[0][3].replace(" %", "").replace(",", ".")) * 10) / 1000);
assert.equal(frWs.getColumn(4).numFmt, "0.0%");
assert.equal(frWs.getCell("C2").value, Number(fr.rows[0][2].replace(" ", "").replace(",", ".")));

// German amounts with a euro sign add up in the summary sheet per branch.
const de = await dataset("de-eu-numbers");
const branch = de.headers.indexOf("Filiale");
const deWb = await sheet(de, branch);
const summary = deWb.getWorksheet("Summary")!;
assert.deepEqual((summary.getRow(1).values as unknown[]).slice(1), ["Filiale", "Records", "Total Menge", "Total Betrag"], "unit prices are not summed");
const kinds = columnKinds(de);
const want = Math.round(de.rows.reduce((s, r) => s + Number(r[5].replace(" €", "").replace(/\./g, "").replace(",", ".")), 0) * 100) / 100;
assert.equal(summary.getRow(summary.rowCount).getCell(4).value, want);
assert.equal(kinds[5].decimal, ",");

// CSV: formula-like text cannot run, and a decimal-comma locale gets semicolons.
const f = await dataset("formula-cells");
const o = { splitBy: null, summary: false, sourceColumns: false, kinds: columnKinds(f) };
const en = (await buildCsv(f, o, "en-US").text()).replace(/^﻿/, "").split("\r\n");
assert.equal(en[1], `"'=HYPERLINK(""http://x"",""click"")",12`);
assert.equal(en[3], "'-discount,1");
assert.equal(en[4], "'@sum(A1),3");
const trCsv = (await buildCsv(tr, { splitBy: null, summary: false, sourceColumns: false, kinds: columnKinds(tr) }, "tr-TR").text()).split("\r\n");
assert.equal(trCsv[0].replace(/^﻿/, ""), "Tarih;Açıklama;Tutar (TL);Bakiye (TL)");
assert.match(trCsv[1], /^2026-10-01;[^;]+;-?\d+(,\d+)?;-?\d+(,\d+)?$/);

console.log("all export tests passed");
