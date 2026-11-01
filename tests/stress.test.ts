// Realistic and broken documents from scripts/make_stress.mjs: number formats from
// five locales, page furniture, totals inside the table, two tables in one file,
// identifiers that look like numbers, rotated pages and files that are not PDFs.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { pageText, type RawItem } from "../src/frame.ts";
import { columnKinds, extractTable, extractTables, numberIn, numericColumns, type PageText } from "../src/table.ts";

const DIR = "tests/fixtures/stress/";

async function load(name: string): Promise<PageText[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`${DIR}${name}.pdf`)), verbosity: 0 }).promise;
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    pages.push(pageText(p, (await page.getTextContent()).items as RawItem[], page.getViewport({ scale: 1 })));
  }
  return pages;
}

const sum = (t: NonNullable<ReturnType<typeof extractTable>>, col: number) => {
  const k = columnKinds(t)[col];
  return Math.round(t.rows.reduce((s, r) => s + (numberIn(k, r[col]) ?? 0), 0) * 100) / 100;
};

for (const d of JSON.parse(readFileSync(`${DIR}truth.json`, "utf8"))) {
  const t = extractTable(await load(d.name));
  assert.ok(t, `${d.name}: a table`);
  assert.deepEqual(t.headers, d.expect.headers, `${d.name}: headers`);
  assert.equal(t.rows.length, d.expect.rows, `${d.name}: rows`);
  if (d.expect.numeric) assert.deepEqual(numericColumns(t).map((i) => t.headers[i]), d.expect.numeric, `${d.name}: numeric columns`);
  if (d.expect.cell) assert.equal(t.rows[d.expect.cell[0]][d.expect.cell[1]], d.expect.cell[2], `${d.name}: cell`);
  if (d.expect.sum) assert.equal(sum(t, d.expect.sum[0]), Math.round(d.expect.sum[1] * 100) / 100, `${d.name}: column total`);
}

// Numbers read in each locale's notation.
const fr = extractTable(await load("fr-spaces"))!;
assert.match(fr.rows[0][2], /^\d{1,3} \d{3},\d{2}$/, "space-grouped thousands stay in one cell");
assert.equal(columnKinds(fr)[3].kind, "percent");
const de = extractTable(await load("de-eu-numbers"))!;
assert.ok(de.rows.every((r) => r[5].endsWith(" €")), "euro sign kept with its amount");
assert.ok(de.rows.some((r) => numberIn(columnKinds(de)[5], r[5])! < 0), "credit notes are negative");
const us = extractTable(await load("us-ledger-signs"))!;
const usAmount = columnKinds(us)[2];
assert.deepEqual(us.rows.slice(0, 4).map((r) => Math.sign(numberIn(usAmount, r[2])!)), [-1, -1, 1, 1], "(x) and x- are negative, $x and x CR are not");

// Identifiers keep their leading zeros and all their digits.
const ids = extractTable(await load("ids-leading-zeros"))!;
assert.deepEqual(columnKinds(ids).map((k) => k.kind), ["text", "text", "text", "number"]);

// Letters drawn edge to edge are one word: ligatures and Japanese.
assert.equal(extractTable(await load("year-headers"))!.rows[2][0], "Gross profit");
assert.deepEqual(extractTable(await load("ja-yen"))!.headers, ["店舗", "商品", "数量", "金額"]);

// Subtotals and the grand total are set aside, and the rows add up to the grand total.
const sub = extractTable(await load("subtotals"))!;
assert.deepEqual(sub.totals!.map((r) => r[0]), ["Subtotal North", "Subtotal South", "Subtotal West", "Grand total"]);
assert.equal(sum(sub, 2), numberIn(columnKinds(sub)[2], sub.totals!.at(-1)![2]));
assert.ok(sub.layout!.lines.filter((l) => l.kind === "total").length === 4);

// The second table in a file is found, not dropped.
const two = extractTables(await load("two-tables"));
assert.equal(two.length, 2, "two tables");
assert.deepEqual(two[1].headers, ["Status", "Count", "Amount"]);
assert.equal(two[1].rows.length, 6);

// Dates in six notations are one date column; formula-like text is text.
assert.equal(columnKinds(extractTable(await load("date-formats"))!)[0].kind, "date");
assert.equal(extractTable(await load("formula-cells"))!.rows[0][0], '=HYPERLINK("http://x","click")');

// Running page numbers never become a column, and the header repeated on 41 pages is not a row.
const long = extractTable(await load("long-2400"))!;
assert.ok(long.rows.every((r, i) => r[0] === String(i + 1)), "rows in order across pages");

// A landscape table on a page turned with /Rotate, and one drawn with turned text, read the same.
for (const name of ["rotate-page", "rotated-text"]) {
  const t = extractTable(await load(name))!;
  assert.deepEqual(t.headers, ["Region", "Rep", "Units", "Revenue"], `${name}: headers`);
  assert.equal(t.rows.length, 12, `${name}: rows`);
  assert.deepEqual(t.rows[0], ["North", "Ana", "10", "1,200.00"], `${name}: first row`);
}

// A PDF that only restricts copying opens normally; broken files fail with a reason pdf.js names.
assert.equal(extractTable(await load("owner-only"))!.rows.length, 35);
const failure = async (name: string) => load(name).then(() => "opened", (e) => `${e.name}${e.code ? ` ${e.code}` : ""}`);
assert.equal(await failure("encrypted"), "PasswordException 1");
for (const name of ["empty", "truncated", "html-renamed"]) assert.equal(await failure(name), "InvalidPDFException", name);

console.log("all stress tests passed");
