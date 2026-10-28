// Runs the table logic against the sample PDFs with pdf.js in Node.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractTable, splitCandidates, numericColumns, type PageText } from "../src/table.ts";

async function load(path: string): Promise<PageText[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push({
      page: p,
      items: (tc.items as any[]).filter((i) => "str" in i).map((i) => ({
        str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, height: i.height,
      })),
    });
  }
  return pages;
}

const m = extractTable(await load("public/samples/membership-register.pdf"))!;
assert.deepEqual(m.headers, ["No", "Member ID", "Full Name", "Branch", "Joined", "Status"]);
assert.equal(m.rows.length, 96, "membership rows");
assert.equal(m.rows[0][0], "1");
assert.ok(m.rows.every((r) => r.every((c) => c !== "")), "no empty cells");
assert.ok(m.rows.every((r, i) => r[0] === String(i + 1)), "row numbers in order across pages");
assert.deepEqual(splitCandidates(m).map((c) => m.headers[c.index]), ["Branch", "Status"]);
assert.deepEqual(numericColumns(m), []);
// The layout marks one "row" line per extracted row and keeps the header on every page.
assert.equal(m.layout!.lines.filter((l) => l.kind === "row").length, m.rows.length, "layout rows");
assert.equal(new Set(m.layout!.lines.filter((l) => l.kind === "header").map((l) => l.page)).size, 3, "header found on each page");
assert.ok(m.layout!.lines.some((l) => l.kind === "skipped"), "titles and footers are marked as skipped");

const o = extractTable(await load("public/samples/store-orders-q3.pdf"))!;
assert.deepEqual(o.headers, ["Order", "Date", "Store", "Product", "Qty", "Unit Price", "Total"]);
assert.equal(o.rows.length, 120, "order rows");
assert.ok(o.rows.every((r) => r.every((c) => c !== "")), "no empty cells");
assert.ok(o.rows.some((r) => r[2] === "New York 5th Ave"), "multi-word cells kept together");
assert.deepEqual(numericColumns(o).map((i) => o.headers[i]), ["Qty", "Unit Price", "Total"]);

// Chrome-printed HTML table: tight columns that pdf.js merges ("6,568.83 Paid").
const inv = extractTable(await load("tests/fixtures/invoices-chrome.pdf"))!;
assert.deepEqual(inv.headers, ["#", "Invoice", "Customer", "Country", "Amount (USD)", "Status"]);
assert.equal(inv.rows.length, 70, "invoice rows");
assert.ok(inv.rows.every((r) => r.every((c) => c !== "")), "no empty cells");
assert.deepEqual(numericColumns(inv).map((i) => inv.headers[i]), ["Amount (USD)"]);

// A letter has no table at all.
assert.equal(extractTable(await load("tests/fixtures/no-table.pdf")), null);

console.log("all extraction tests passed");
