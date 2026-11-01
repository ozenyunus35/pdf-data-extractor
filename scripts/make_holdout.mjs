// Holdout set: layouts written after the extractor was tuned, to check it reads documents it was
// not shaped around. Usage: node scripts/make_holdout.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../tests/fixtures/holdout/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let seed = 99;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const amt = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const us = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eu = (n, l = "es-ES") => n.toLocaleString(l, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });

const base = `body{font-family:Georgia,serif;font-size:11px;margin:30px}h1{font-size:18px}table{border-collapse:collapse;margin:10px 0}`;
const page = (css, body) => `<!doctype html><meta charset="utf-8"><style>${base}${css}</style>${body}`;
const table = (h, rows, right = []) => `<table><tr>${h.map((x, i) => `<th${right.includes(i) ? ' style="text-align:right"' : ""}>${x}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td${right.includes(i) ? ' style="text-align:right"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</table>`;

const docs = [];
const add = (name, html, expect, opts = {}) => docs.push({ name, html, expect, ...opts });

// a. Fully bordered grid, tight padding.
{
  const rows = Array.from({ length: 25 }, (_, i) => [`EMP-${200 + i}`, pick(["Alice Brown", "Omar Haddad", "Mei Lin", "Jon Ruiz"]), pick(["Sales", "Finance", "IT"]), `${1 + (i % 28)}/0${1 + (i % 9)}/2026`, us(amt(2000, 9000))]);
  add("bordered-grid", page("td,th{border:1px solid #000;padding:1px 3px}", `<h1>Payroll</h1>${table(["Employee", "Name", "Dept", "Paid on", "Gross"], rows, [4])}`), { headers: ["Employee", "Name", "Dept", "Paid on", "Gross"], rows: 25, numeric: ["Gross"], kind: [3, "date"] });
}
// b. Tight adjacent text columns.
{
  const rows = Array.from({ length: 20 }, () => [pick(["Ava", "Lena", "Tom", "Kai"]), pick(["Germany", "Spain", "Brazil", "Japan"]), pick(["Paid", "Open", "Late"]), pick(["Berlin", "Madrid", "Recife", "Osaka"])]);
  add("tight-text", page("td,th{padding:0 4px;text-align:left}", `<h1>Contacts</h1>${table(["Name", "Country", "Status", "City"], rows)}`), { headers: ["Name", "Country", "Status", "City"], rows: 20 });
}
// c. Statement with separate debit/credit columns (one empty per row), dd/mm/yyyy.
{
  let bal = 5000;
  const rows = Array.from({ length: 28 }, (_, i) => {
    const c = rnd() < 0.3, v = amt(5, 900);
    bal += c ? v : -v;
    return [`${String(1 + i).padStart(2, "0")}/10/2026`, pick(["Card payment TESCO", "Salary ACME LTD", "Direct debit COUNCIL TAX", "Transfer to savings"]), c ? "" : us(v), c ? us(v) : "", us(bal)];
  });
  add("debit-credit", page("td,th{padding:2px 8px}", `<h1>Current account statement</h1><p>Sort code 00-00-00 · Account 00000000</p>${table(["Date", "Description", "Paid out", "Paid in", "Balance"], rows, [2, 3, 4])}`), { headers: ["Date", "Description", "Paid out", "Paid in", "Balance"], rows: 28, numeric: ["Paid out", "Paid in", "Balance"], kind: [0, "date"] });
}
// d. US dates where every day is 12 or less: month-first cannot be proven.
{
  const rows = Array.from({ length: 10 }, (_, i) => [`0${1 + (i % 9)}/0${2 + (i % 7)}/2026`, pick(["Shipped", "Delivered"]), `SO-${900 + i}`]);
  add("ambiguous-dates", page("td,th{padding:2px 10px}", `<h1>Shipments</h1>${table(["Date", "Event", "Order ref"], rows)}`), { headers: ["Date", "Event", "Order ref"], rows: 10, ambiguous: true });
}
// e. Spanish invoice: items, then totals box.
{
  const rows = Array.from({ length: 6 }, () => [pick(["Consultoría", "Licencia anual", "Soporte técnico", "Formación"]), String(1 + Math.floor(rnd() * 9)), eu(amt(20, 500)), eu(amt(100, 4000))]);
  add("es-invoice", page("td,th{padding:3px 10px}.box{margin-left:300px}", `<h1>FACTURA F-2026-0042</h1><p>Cliente: Ejemplo S.L. · NIF B00000000</p>${table(["Descripción", "Cant.", "Precio unitario", "Importe"], rows, [1, 2, 3])}<div class="box">${table(["", ""], [["Base imponible", "8.123,45 €"], ["IVA 21%", "1.705,92 €"], ["Total", "9.829,37 €"]], [1])}</div>`), { headers: ["Descripción", "Cant.", "Precio unitario", "Importe"], rows: 6, numeric: ["Cant.", "Precio unitario", "Importe"] });
}
// f. Grouped rows: the group label only on the first row of each group.
{
  const rows = [];
  for (const r of ["North", "South", "East"]) for (let i = 0; i < 5; i++) rows.push([i ? "" : r, pick(["Widget", "Gadget", "Doohickey"]), String(Math.floor(amt(1, 99))), us(amt(10, 999))]);
  add("grouped-blank", page("td,th{padding:2px 10px}", `<h1>Sales by region</h1>${table(["Region", "Product", "Units", "Revenue"], rows, [2, 3])}`), { headers: ["Region", "Product", "Units", "Revenue"], rows: 15, numeric: ["Units", "Revenue"] });
}
// g. Product names that start with "Total".
{
  const names = ["Total Care Shampoo", "Totally Nuts Mix", "Sum Up Calculator", "Grand Total Planner", "Daily Vitamins", "Total Clean Spray", "Summit Boots", "Granola Bar"];
  const rows = names.map((n, i) => [`P${i + 1}`, n, String(1 + i), us(amt(2, 40))]);
  add("total-names", page("td,th{padding:2px 10px}", `<h1>Price list</h1>${table(["Code", "Product", "Stock", "Price"], rows, [2, 3])}`), { headers: ["Code", "Product", "Stock", "Price"], rows: 8 });
}
// h. Running header and footer text on every page, 5 pages.
{
  const rows = Array.from({ length: 160 }, (_, i) => [String(i + 1), pick(["Laptop", "Phone", "Tablet", "Monitor"]), pick(["Warehouse A", "Warehouse B"]), String(Math.floor(amt(0, 500)))]);
  add("running-headers", page("td,th{padding:2px 10px}thead{display:table-header-group}", `<h1>Stock count</h1><table><thead><tr><th>Line</th><th>Item</th><th>Location</th><th style="text-align:right">Count</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 3 ? ' style="text-align:right"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`),
    { headers: ["Line", "Item", "Location", "Count"], rows: 160 }, { headerTemplate: '<div style="font-size:8px;width:100%;padding:0 20mm">ACME Corp · Confidential · Internal use only</div>', footerTemplate: '<div style="font-size:8px;width:100%;padding:0 20mm">Printed 01.11.2026 by J. Smith<span style="float:right">Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span></div>' });
}
// i. A two-row table.
add("tiny", page("td,th{padding:2px 10px}", `<h1>Quote</h1>${table(["Item", "Qty", "Amount"], [["Setup fee", "1", "250.00"], ["Monthly plan", "12", "1,188.00"]], [1, 2])}`), { headers: ["Item", "Qty", "Amount"], rows: 2, numeric: ["Qty", "Amount"] });
// j. Italian with currency code prefix and unicode minus.
{
  const rows = Array.from({ length: 15 }, (_, i) => [pick(["Milano", "Roma", "Torino"]), `EUR ${eu(amt(100, 50000), "it-IT")}`, `${i % 4 === 0 ? "−" : ""}${eu(amt(1, 900), "it-IT")}`]);
  add("it-eur-prefix", page("td,th{padding:2px 10px}", `<h1>Riepilogo filiali</h1>${table(["Filiale", "Fatturato", "Variazione"], rows, [1, 2])}`), { headers: ["Filiale", "Fatturato", "Variazione"], rows: 15, numeric: ["Fatturato", "Variazione"] });
}
// k. Wrapped long descriptions in a narrow column plus amounts.
{
  const rows = Array.from({ length: 12 }, (_, i) => [`2026-10-${String(10 + i)}`, `<div style="width:160px">${pick(["Annual maintenance contract renewal for the north campus HVAC units", "Emergency call-out, burst pipe in basement storage", "Quarterly inspection"])}</div>`, us(amt(100, 5000))]);
  add("wrapped-narrow", page("td,th{padding:2px 10px;vertical-align:top}", `<h1>Work orders</h1>${table(["Date", "Description", "Amount"], rows, [2])}`), { headers: ["Date", "Description", "Amount"], rows: 12, numeric: ["Amount"] });
}
// l. Two-column page layout of key/value pairs only (no real table) plus a paragraph.
add("no-table-kv", page("", `<h1>Employment letter</h1><p>Dear Ms Example, we are pleased to confirm your employment with the company starting on the first of December under the terms set out below. Please read them carefully and sign the attached copy.</p><p>Position: Analyst<br>Start date: 01.12.2026<br>Salary: 52,000.00 per year</p><p>Kind regards,<br>HR</p>`), { none: true });

const browser = await chromium.launch();
const pg = await browser.newPage();
for (const d of docs) {
  await pg.setContent(d.html);
  await pg.pdf({ path: `${OUT}${d.name}.pdf`, format: "A4", margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" }, displayHeaderFooter: !!d.footerTemplate, headerTemplate: d.headerTemplate ?? "<span></span>", footerTemplate: d.footerTemplate ?? "<span></span>" });
}
await browser.close();
writeFileSync(`${OUT}truth.json`, JSON.stringify(docs.map(({ html, ...d }) => d), null, 1));
console.log(`${docs.length} holdout PDFs`);
