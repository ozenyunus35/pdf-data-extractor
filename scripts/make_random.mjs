// Random tables, cell-by-cell truth in truth.json. Usage: node scripts/make_random.mjs [count] [seed]
// Random tables: column count, value types, alignment, padding, font, rows, locale and page furniture all vary.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../tests/fixtures/random/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const N = Number(process.argv[2] ?? 60);
let seed = Number(process.argv[3] ?? 2026);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];

const WORDS = ["Alpha", "Beacon", "Cedar", "Delta", "Ember", "Falcon", "Granite", "Harbor", "Iris", "Juniper", "Kestrel", "Lumen", "Maple", "Nimbus", "Orchid", "Pioneer", "Quartz", "Raven", "Sierra", "Tundra"];
const LOCALES = ["en-US", "de-DE", "tr-TR", "fr-FR", "en-GB"];
const HEADS = { text: ["Customer", "Product", "City", "Category", "Supplier", "Status", "Owner"], code: ["Ref", "SKU", "Invoice"], date: ["Date", "Booked", "Due"], int: ["Qty", "Units", "Visits"], money: ["Amount", "Revenue", "Cost", "Balance", "Net"], pct: ["Margin", "Share", "Growth"] };

function value(type, loc, i) {
  if (type === "text") return Array.from({ length: int(1, 3) }, () => pick(WORDS)).join(" ");
  if (type === "code") return `${pick(["A", "B", "K"])}-${int(100, 99999)}`;
  if (type === "date") { const d = new Date(Date.UTC(2026, int(0, 11), int(1, 28))); return loc === "en-US" ? d.toLocaleDateString("en-US", { timeZone: "UTC" }) : loc === "en-GB" ? d.toLocaleDateString("en-GB", { timeZone: "UTC" }) : d.toISOString().slice(0, 10).split("-").reverse().join("."); }
  if (type === "int") return String(int(0, 2000));
  if (type === "money") return (((rnd() < 0.15 ? -1 : 1) * int(1, 9999999)) / 100).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${(rnd() * 60).toLocaleString(loc, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

const docs = [];
for (let n = 0; n < N; n++) {
  const loc = pick(LOCALES);
  const cols = int(2, 8);
  const types = ["text", ...Array.from({ length: cols - 1 }, () => pick(["text", "code", "date", "int", "money", "money", "pct"]))];
  const used = new Set();
  const headers = types.map((t) => { let h = pick(HEADS[t]); while (used.has(h)) h = `${h} ${used.size}`; used.add(h); return h; });
  const rows = Array.from({ length: int(3, 70) }, (_, i) => types.map((t) => value(t, loc, i)));
  const right = types.map((t) => ["int", "money", "pct"].includes(t) && rnd() < 0.85);
  const pad = int(3, 14), font = pick(["Helvetica, Arial", "Georgia, serif", "Courier New, monospace", "Verdana"]), size = int(8, 12);
  const border = pick(["none", "row", "grid"]);
  const title = rnd() < 0.8 ? `<h1 style="font-size:${size + 6}px">${pick(WORDS)} report</h1><p>Generated for ${pick(WORDS)} ${pick(WORDS)} · ${loc}</p>` : "";
  const note = rnd() < 0.5 ? `<p>Figures are unaudited and may change. Contact ${pick(WORDS)} for questions about this report.</p>` : "";
  const css = `body{font-family:${font};font-size:${size}px;margin:24px}table{border-collapse:collapse}td,th{padding:2px ${pad}px;text-align:left;${border === "grid" ? "border:1px solid #444;" : border === "row" ? "border-bottom:1px solid #ccc;" : ""}}.r{text-align:right}`;
  const html = `<!doctype html><meta charset="utf-8"><style>${css}</style>${title}<table><thead><tr>${headers.map((h, i) => `<th class="${right[i] ? "r" : ""}">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${right[i] ? "r" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table>${note}`;
  docs.push({ name: `random-${String(n).padStart(2, "0")}`, html, headers, rows, types, loc, footer: rnd() < 0.6, landscape: cols > 6 && rnd() < 0.5 });
}

const browser = await chromium.launch();
const pg = await browser.newPage();
for (const d of docs) {
  await pg.setContent(d.html);
  await pg.pdf({ path: `${OUT}${d.name}.pdf`, format: "A4", landscape: d.landscape, margin: { top: "14mm", bottom: "14mm", left: "10mm", right: "10mm" }, displayHeaderFooter: d.footer, headerTemplate: '<div style="font-size:8px;width:100%;padding:0 10mm">Internal · do not distribute</div>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
}
await browser.close();
writeFileSync(`${OUT}truth.json`, JSON.stringify(docs.map(({ html, ...d }) => d)));
console.log(`${docs.length} random tables`);
