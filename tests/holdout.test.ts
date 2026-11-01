// Documents written after the extractor was tuned: the holdout set must read exactly, and the
// random set (scripts/make_random.mjs: column types, alignment, padding, fonts, locales, page
// furniture all random) must read cell for cell in at least 85 of every 100 tables.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { pageText, type RawItem } from "../src/frame.ts";
import { columnKinds, extractTable, numericColumns, type PageText } from "../src/table.ts";

async function load(path: string): Promise<PageText[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    pages.push(pageText(p, (await page.getTextContent()).items as RawItem[], page.getViewport({ scale: 1 })));
  }
  return pages;
}

for (const d of JSON.parse(readFileSync("tests/fixtures/holdout/truth.json", "utf8"))) {
  const t = extractTable(await load(`tests/fixtures/holdout/${d.name}.pdf`));
  if (d.expect.none) {
    assert.equal(t, null, `${d.name}: no table`);
    continue;
  }
  assert.ok(t, `${d.name}: a table`);
  assert.deepEqual(t.headers, d.expect.headers, `${d.name}: headers`);
  assert.equal(t.rows.length, d.expect.rows, `${d.name}: rows`);
  if (d.expect.numeric) assert.deepEqual(numericColumns(t).map((i) => t.headers[i]), d.expect.numeric, `${d.name}: numeric`);
  if (d.expect.kind) assert.equal(columnKinds(t)[d.expect.kind[0]].kind, d.expect.kind[1], `${d.name}: column kind`);
  // 03/04/2026 could be either day-first or month-first: left as text rather than guessed.
  if (d.expect.ambiguous) assert.equal(columnKinds(t)[0].kind, "text", `${d.name}: ambiguous dates stay text`);
}

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
const random = JSON.parse(readFileSync("tests/fixtures/random/truth.json", "utf8"));
const missed: string[] = [];
for (const d of random) {
  const t = extractTable(await load(`tests/fixtures/random/${d.name}.pdf`));
  const exact = !!t && JSON.stringify(t.headers) === JSON.stringify(d.headers) && t.rows.length === d.rows.length && d.rows.every((r: string[], i: number) => r.every((c, j) => norm(t.rows[i][j]) === norm(c)));
  if (!exact) missed.push(d.name);
}
const share = (random.length - missed.length) / random.length;
console.log(`random tables read exactly: ${random.length - missed.length}/${random.length}${missed.length ? ` (missed ${missed.join(", ")})` : ""}`);
assert.ok(share >= 0.85, `at least 85% of random tables exact, got ${Math.round(share * 100)}%`);

console.log("all holdout tests passed");
