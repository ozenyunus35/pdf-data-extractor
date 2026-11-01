// Stress corpus: realistic synthetic documents printed by Chromium, with what a
// correct extraction returns in truth.json. Usage: node scripts/make_stress.mjs
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../tests/fixtures/stress/", import.meta.url).pathname;
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const amt = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;

const fmt = {
  us: (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  de: (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  tr: (n) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fr: (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};

const css = `body{font-family:Helvetica,Arial,sans-serif;font-size:10px;margin:28px;color:#111}
h1{font-size:16px;margin:0 0 4px}p{margin:0 0 10px;color:#444}
table{border-collapse:collapse;width:100%;margin:8px 0 14px}th{text-align:left;border-bottom:1px solid #333;padding:3px 6px}
td{padding:2px 6px;border-bottom:1px solid #eee}.r{text-align:right}tr.tot td{font-weight:bold;border-top:1px solid #333}`;

function table(headers, rows, right = [], cls = []) {
  const th = headers.map((h, i) => `<th class="${right.includes(i) ? "r" : ""}">${h}</th>`).join("");
  const tr = rows.map((r, k) => `<tr class="${cls[k] ?? ""}">${r.map((c, i) => `<td class="${right.includes(i) ? "r" : ""}">${c}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><h1>${title}</h1><p>${sub}</p>${body}`;

const docs = [];
const add = (name, html, expect, opts = {}) => docs.push({ name, html, expect, ...opts });

// 1. German sales report, comma decimals, euro suffix, negatives.
{
  const rows = Array.from({ length: 40 }, (_, i) => {
    const q = 1 + Math.floor(rnd() * 40), p = amt(2, 900);
    return [`2026-0${1 + (i % 9)}-1${i % 10}`, pick(["Berlin", "München", "Köln", "Hamburg"]), pick(["Schrauben M6", "Kabel 3m", "Bohrer Set", "Dübel 8mm"]), String(q), fmt.de(p) + " €", fmt.de(i % 7 === 3 ? -q * p : q * p) + " €"];
  });
  add("de-eu-numbers", page("Umsatzbericht Q3", "Alle Beträge in Euro, inkl. Gutschriften", table(["Datum", "Filiale", "Artikel", "Menge", "Einzelpreis", "Betrag"], rows, [3, 4, 5])),
    { headers: ["Datum", "Filiale", "Artikel", "Menge", "Einzelpreis", "Betrag"], rows: 40, numeric: ["Menge", "Einzelpreis", "Betrag"], cell: [0, 5, rows[0][5]] });
}

// 2. Turkish bank statement.
{
  let bal = 15000;
  const rows = Array.from({ length: 30 }, (_, i) => {
    const v = rnd() < 0.3 ? amt(500, 9000) : -amt(10, 1500);
    bal += v;
    return [`${String(1 + (i % 28)).padStart(2, "0")}.10.2026`, pick(["MARKET ALIŞVERİŞİ ŞİŞLİ", "EFT GELEN ÖZEN Ç.", "FATURA ÖDEMESİ İGDAŞ", "POS İŞLEMİ ÇAĞDAŞ ECZ."]), fmt.tr(v), fmt.tr(bal)];
  });
  add("tr-statement", page("HESAP EKSTRESİ", "Hesap No: TR00 0000 0000 0000 0000 0000 00 · Dönem: Ekim 2026", table(["Tarih", "Açıklama", "Tutar (TL)", "Bakiye (TL)"], rows, [2, 3])),
    { headers: ["Tarih", "Açıklama", "Tutar (TL)", "Bakiye (TL)"], rows: 30, numeric: ["Tutar (TL)", "Bakiye (TL)"], sum: [2, rows.reduce((s, r) => s + Number(r[2].replace(/\./g, "").replace(",", ".")), 0)] });
}

// 3. French: narrow no-break space thousands.
{
  const rows = Array.from({ length: 25 }, () => [pick(["Lyon", "Paris", "Nantes"]), pick(["Licence", "Support", "Formation"]), fmt.fr(amt(1000, 250000)), `${(rnd() * 30).toFixed(1).replace(".", ",")} %`]);
  add("fr-spaces", page("Chiffre d'affaires par agence", "Montants HT en euros", table(["Agence", "Produit", "Montant HT", "Marge"], rows, [2, 3])),
    { headers: ["Agence", "Produit", "Montant HT", "Marge"], rows: 25, numeric: ["Montant HT", "Marge"] });
}

// 4. US ledger: parentheses, trailing minus, CR/DR, dollar sign, percentages.
{
  const rows = Array.from({ length: 30 }, (_, i) => {
    const v = amt(10, 50000);
    const style = i % 4;
    const shown = style === 0 ? `(${fmt.us(v)})` : style === 1 ? `${fmt.us(v)}-` : style === 2 ? `$${fmt.us(v)}` : `${fmt.us(v)} CR`;
    return [`GL-${4000 + i}`, pick(["Rent", "Payroll", "Software", "Travel"]), shown, `${(rnd() * 20).toFixed(1)}%`];
  });
  add("us-ledger-signs", page("General Ledger Detail", "FY2026, USD", table(["Account", "Category", "Amount", "Share"], rows, [2, 3])),
    { headers: ["Account", "Category", "Amount", "Share"], rows: 30, numeric: ["Amount", "Share"] });
}

// 5. Identifiers that look like numbers: leading zeros, ZIP, 16-digit card numbers.
{
  const rows = Array.from({ length: 20 }, (_, i) => [String(i * 37 + 12).padStart(6, "0"), String(1000 + i * 413).padStart(5, "0"), `4${String(Math.floor(rnd() * 1e15)).padStart(15, "0")}`, fmt.us(amt(5, 900))]);
  add("ids-leading-zeros", page("Customer Accounts", "Masked export", table(["Account", "ZIP", "Card Number", "Balance"], rows, [3])),
    { headers: ["Account", "ZIP", "Card Number", "Balance"], rows: 20, numeric: ["Balance"], cell: [0, 0, rows[0][0]] });
}

// 6. Sparse optional columns.
{
  const rows = Array.from({ length: 30 }, (_, i) => [`SKU-${100 + i}`, pick(["Desk lamp", "Office chair", "Monitor arm", "Cable tray"]), String(1 + (i % 9)), i % 5 === 0 ? "10%" : "", i % 3 === 0 ? "backorder" : "", fmt.us(amt(20, 800))]);
  add("sparse-columns", page("Purchase Order Lines", "PO 2026-1188", table(["SKU", "Item", "Qty", "Discount", "Note", "Line Total"], rows, [2, 3, 5])),
    { headers: ["SKU", "Item", "Qty", "Discount", "Note", "Line Total"], rows: 30 });
}

// 7. Comparative financial statement: year headers are numbers.
{
  const items = ["Revenue", "Cost of sales", "Gross profit", "Operating expenses", "Operating profit", "Finance costs", "Profit before tax", "Income tax", "Net profit"];
  const rows = items.map((it) => [it, fmt.us(amt(1e4, 9e5)), fmt.us(amt(1e4, 9e5))]);
  add("year-headers", page("Income Statement", "For the years ended 31 December", table(["", "2026", "2025"], rows, [1, 2])),
    { headers: ["Column 1", "2026", "2025"], rows: 9, numeric: ["2026", "2025"] });
}

// 8. Subtotal and grand total rows inside the table.
{
  const rows = [], cls = [];
  let grand = 0;
  for (const region of ["North", "South", "West"]) {
    let sub = 0;
    for (let i = 0; i < 6; i++) { const v = amt(100, 5000); sub += v; rows.push([region, pick(["Ana Lee", "Ben Ortiz", "Cai Wu"]), fmt.us(v)]); cls.push(""); }
    rows.push([`Subtotal ${region}`, "", fmt.us(sub)]); cls.push("tot");
    grand += sub;
  }
  rows.push(["Grand total", "", fmt.us(grand)]); cls.push("tot");
  add("subtotals", page("Sales by Region", "Q3 2026", table(["Region", "Rep", "Sales"], rows, [2], cls)),
    { headers: ["Region", "Rep", "Sales"], rows: 18 });
}

// 9. Two tables: a 6-row summary and a 35-row detail with different columns.
{
  const sum = ["Open", "Paid", "Overdue", "Disputed", "Written off", "Credit"].map((s) => [s, String(Math.floor(rnd() * 90)), fmt.us(amt(1000, 90000))]);
  const det = Array.from({ length: 35 }, (_, i) => [`INV-${7000 + i}`, pick(["Acme Ltd", "Borealis", "Cobalt GmbH"]), `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, pick(["Open", "Paid", "Overdue"]), fmt.us(amt(100, 9000))]);
  add("two-tables", page("Receivables Report", "Summary by status, then all invoices", table(["Status", "Count", "Amount"], sum, [1, 2]) + "<p>Invoice detail</p>" + table(["Invoice", "Customer", "Date", "Status", "Amount"], det, [4])),
    { headers: ["Invoice", "Customer", "Date", "Status", "Amount"], rows: 35 });
}

// 10. Wide landscape table, 12 columns, small font.
{
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
  const rows = Array.from({ length: 22 }, (_, i) => [`Store ${i + 1}`, ...months.map(() => String(Math.floor(amt(100, 99999)))), String(Math.floor(amt(1e5, 9e5)))]);
  add("wide-landscape", page("Monthly Units by Store", "2026", `<div style="font-size:8px">${table(["Store", ...months, "Total"], rows, months.map((_, i) => i + 1).concat(11))}</div>`),
    { headers: ["Store", ...months, "Total"], rows: 22 }, { landscape: true });
}

// 11. Long multi-page table: 2400 rows.
{
  const rows = Array.from({ length: 2400 }, (_, i) => [String(i + 1), `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, pick(["Card", "Cash", "Transfer"]), pick(["Groceries", "Fuel", "Rent", "Utilities", "Dining out"]), fmt.us(amt(1, 3000))]);
  add("long-2400", page("Transactions Export", "All accounts, 2026", table(["No", "Date", "Method", "Category", "Amount"], rows, [4])),
    { headers: ["No", "Date", "Method", "Category", "Amount"], rows: 2400 });
}

// 12. Three-line header.
{
  const rows = Array.from({ length: 15 }, (_, i) => [`P-${i + 1}`, String(Math.floor(amt(1, 500))), fmt.us(amt(1, 99)), fmt.us(amt(100, 9999))]);
  add("three-line-header", page("Inventory Valuation", "Warehouse 3", table(["Part<br>Number<br>(internal)", "Quantity<br>on hand<br>(units)", "Unit<br>cost<br>(USD)", "Extended<br>value<br>(USD)"], rows, [1, 2, 3])),
    { headers: ["Part Number (internal)", "Quantity on hand (units)", "Unit cost (USD)", "Extended value (USD)"], rows: 15 });
}

// 13. Dates in many formats.
{
  const ds = ["14 Mar 2026", "03/14/2026", "14.03.2026", "2026-03-14", "March 14, 2026", "14-Mar-26"];
  const rows = Array.from({ length: 18 }, (_, i) => [ds[i % ds.length], pick(["Opened", "Closed", "Escalated"]), `T-${300 + i}`]);
  add("date-formats", page("Ticket Log", "Mixed sources", table(["Date", "Event", "Ticket"], rows)),
    { headers: ["Date", "Event", "Ticket"], rows: 18 });
}

// 14. Japanese and yen.
{
  const rows = Array.from({ length: 12 }, () => [pick(["東京本店", "大阪支店", "名古屋支店"]), pick(["ノートPC", "モニター", "キーボード"]), String(1 + Math.floor(rnd() * 20)), `¥${Math.floor(amt(1000, 300000)).toLocaleString("ja-JP")}`]);
  add("ja-yen", page("売上明細", "2026年10月", table(["店舗", "商品", "数量", "金額"], rows, [2, 3])),
    { headers: ["店舗", "商品", "数量", "金額"], rows: 12, numeric: ["数量", "金額"] });
}

// 15. CSV/formula injection: descriptions starting with = + - @.
{
  const rows = [["=HYPERLINK(\"http://x\",\"click\")", "12.00"], ["+1 555 0100", "4.50"], ["-discount", "1.00"], ["@sum(A1)", "3.00"], ["Normal item", "8.00"], ["Another", "2.00"]];
  add("formula-cells", page("Expense lines", "Imported", table(["Description", "Amount"], rows, [1])),
    { headers: ["Description", "Amount"], rows: 6 });
}

const browser = await chromium.launch();
const pg = await browser.newPage();
for (const d of docs) {
  await pg.setContent(d.html);
  await pg.pdf({ path: `${OUT}${d.name}.pdf`, format: "A4", landscape: !!d.landscape, margin: { top: "12mm", bottom: "14mm", left: "10mm", right: "10mm" }, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: '<div style="font-size:8px;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
}
await browser.close();
writeFileSync(`${OUT}truth.json`, JSON.stringify(docs.map(({ html, ...d }) => d), null, 1));

// Broken and unusual files: what people really drop on the page.
function rawPdf(name, content, { rotate = 0, w = 595, h = 842 } = {}) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Rotate ${rotate} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  writeFileSync(`${OUT}${name}.pdf`, out, "latin1");
}
const small = [["Region", "Rep", "Units", "Revenue"], ...["North Ana", "South Ben", "West Cai", "East Dee"].flatMap((s) => [s, s, s]).map((s, i) => [...s.split(" "), String(10 + i * 3), fmt.us(1200 + i * 97.5)])];
const drawn = (turned) => "BT /F1 10 Tf\n" + small.flatMap((row, k) => row.map((v, c) => {
  const x = [40, 160, 300, 420][c], y = 550 - k * 16;
  // Turned: a landscape table drawn with rotated text on a portrait page.
  return turned ? `0 1 -1 0 ${595 - y} ${x} Tm (${v}) Tj` : `1 0 0 1 ${x} ${y} Tm (${v}) Tj`;
})).join("\n") + "\nET";
rawPdf("rotate-page", drawn(false), { rotate: 90, w: 842, h: 595 });
rawPdf("rotated-text", drawn(true));
writeFileSync(`${OUT}empty.pdf`, "");
writeFileSync(`${OUT}truncated.pdf`, readFileSync(`${OUT}long-2400.pdf`).subarray(0, 9000));
writeFileSync(`${OUT}html-renamed.pdf`, docs.find((d) => d.name === "two-tables").html);
// Needs Ghostscript: a PDF that asks for a password ("user"), and one that only restricts copying.
const gs = (args) => execFileSync("gs", ["-q", "-sDEVICE=pdfwrite", "-sOwnerPassword=own", "-dEncryptionR=3", "-dKeyLength=128", ...args, `${OUT}two-tables.pdf`]);
gs(["-sUserPassword=user", "-o", `${OUT}encrypted.pdf`]);
gs(["-dPermissions=-3904", "-o", `${OUT}owner-only.pdf`]);
console.log(`${docs.length} PDFs and 7 unusual files`);
