import "./style.css";
import { PdfError, readPdf, renderPage } from "./pdf";
import { columnKinds, extractTables, numberIn, PER_UNIT, splitCandidates, type ColumnKind, type Layout, type Table } from "./table";
import { buildWorkbook, buildCsv, groups, type Dataset } from "./export";
import { displayMatrix, readingHeight, type Frame } from "./frame";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const drop = $("drop"), input = $<HTMLInputElement>("file"), status = $("status");
const split = $<HTMLSelectElement>("split"), summary = $<HTMLInputElement>("summary"), source = $<HTMLInputElement>("source");
const table = $<HTMLTableElement>("preview"), sheetsBar = $("sheets"), tablePick = $<HTMLSelectElement>("table-pick");

interface Loaded {
  name: string;
  data: ArrayBuffer;
  pages: number;
  rows: number;
  layout?: Layout;
  skipped?: string;
  password?: string;
  frames: Frame[];
  tables: Table[];
}

let data: Dataset | null = null;
let kinds: ColumnKind[] = [];
let files: Loaded[] = [];
let baseName = "extracted";
let sheet: string | null = null; // null = all rows
let detectAt = 0; // index into detectPages()

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/* Theme */
$("theme").addEventListener("click", () => {
  const dark = document.documentElement.classList.toggle("dark");
  try {
    localStorage.setItem("pdfx:theme", dark ? "dark" : "light");
  } catch {}
});

/* Input */
$("pick").addEventListener("click", () => input.click());
input.addEventListener("change", () => input.files?.length && handle([...input.files]));
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const pdfs = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfs.length) handle(pdfs);
  else setStatus("Please drop PDF files.", true);
});

document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((b) => b.addEventListener("click", () => loadSample(b.dataset.sample!)));

async function loadSample(name: string) {
  document.querySelectorAll("[data-sample]").forEach((b) => b.setAttribute("aria-current", String((b as HTMLElement).dataset.sample === name)));
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
  await handle([new File([await res.blob()], name, { type: "application/pdf" })]);
}

function setStatus(msg: string, error = false) {
  status.textContent = msg;
  status.classList.toggle("error", error);
}

function setStep(step: string | null) {
  const order = ["read", "detect", "clean", "done"];
  const steps = $("steps");
  steps.hidden = step === null;
  steps.querySelectorAll<HTMLElement>("[data-step]").forEach((el) => {
    const i = order.indexOf(el.dataset.step!), at = order.indexOf(step ?? "");
    el.classList.toggle("done", i < at || step === "done");
    el.classList.toggle("active", i === at && step !== "done");
  });
}

/** Asks for a PDF's password; null when the person skips the file. */
function askPassword(name: string, wrong: boolean): Promise<string | null> {
  const dialog = $<HTMLDialogElement>("pw"), input = $<HTMLInputElement>("pw-input");
  $("pw-text").textContent = wrong ? `That password did not open ${name}. Try again.` : `${name} is protected. Its password stays in this browser tab.`;
  input.value = "";
  dialog.returnValue = "";
  dialog.showModal();
  input.focus();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok" && input.value ? input.value : null), { once: true }));
}

async function handle(list: File[]) {
  const t0 = performance.now();
  setStatus("");
  setStep("read");
  await nextFrame();
  const merged: Dataset = { headers: [], rows: [], source: [], files: [], totals: [] };
  const loaded: Loaded[] = [];
  let pages = 0;

  for (const file of list) {
    const buf = await file.arrayBuffer();
    let password: string | undefined;
    let text: Awaited<ReturnType<typeof readPdf>>;
    try {
      for (;;) {
        try {
          text = await readPdf(buf, password);
          break;
        } catch (e) {
          if (!(e instanceof PdfError) || (e.reason !== "password" && e.reason !== "wrong password")) throw e;
          setStep(null);
          const given = await askPassword(file.name, e.reason === "wrong password");
          if (given === null) throw new PdfError("password");
          password = given;
          setStep("read");
        }
      }
    } catch (e) {
      const reason = e instanceof PdfError ? (e.reason === "password" ? "password protected" : e.reason) : "could not be read";
      loaded.push({ name: file.name, data: buf, pages: 0, rows: 0, skipped: reason, frames: [], tables: [] });
      continue;
    }
    pages += text.length;
    setStep("detect");
    await nextFrame();
    const tables = extractTables(text);
    const t = tables[0];
    const entry: Loaded = { name: file.name, data: buf, pages: text.length, rows: 0, layout: t?.layout, password, frames: text.map((p) => p.frame), tables };
    loaded.push(entry);
    if (!t || t.rows.length === 0) {
      // No selectable text at all means a scan or a photo saved as PDF.
      entry.skipped = text.every((p) => !p.items.some((i) => i.str.trim())) ? "scanned image, no text layer" : "no table found";
      continue;
    }
    if (merged.headers.length && t.headers.join("|") !== merged.headers.join("|")) {
      entry.skipped = "different columns";
      continue;
    }
    setStep("clean");
    merged.headers = t.headers;
    merged.rows.push(...t.rows);
    merged.source.push(...t.source);
    merged.files.push(...t.rows.map(() => file.name));
    merged.totals!.push(...(t.totals ?? []));
    entry.rows = t.rows.length;
  }

  files = loaded;
  renderFiles();
  if (!merged.rows.length) {
    setStep(null);
    const all = (reason: string) => loaded.length > 0 && loaded.every((f) => f.skipped === reason);
    const names = loaded.filter((f) => f.skipped && f.skipped !== "no table found").map((f) => `${f.name} (${f.skipped})`).join(", ");
    setStatus(
      all("scanned image, no text layer")
        ? "This PDF is a scanned image with no selectable text, so there is no table to read. For scans and photos, try Tally, which runs OCR in the browser: ozenyunus35.github.io/invoice-extractor"
        : all("password protected")
          ? "This PDF is password protected. Open it again and enter its password to read the table."
          : names && loaded.every((f) => f.skipped !== "no table found")
            ? `Could not open: ${names}. Choose a PDF file that opens in a PDF viewer.`
            : "No table was found. This works with digital PDFs whose text can be selected.",
      true,
    );
    return;
  }

  data = merged;
  kinds = columnKinds(data);
  sheet = null;
  detectAt = 0;
  baseName = list.length === 1 ? list[0].name.replace(/\.pdf$/i, "") : "merged-tables";
  setStep("done");
  const skipped = loaded.filter((f) => f.skipped);
  setStatus([skipped.length ? `Skipped: ${skipped.map((f) => `${f.name} (${f.skipped})`).join(", ")}.` : "", totalsNote(data)].filter(Boolean).join(" "));
  // One file with several tables: let the person pick which one to export.
  const own = loaded.length === 1 ? loaded[0].tables : [];
  $("table-field").hidden = own.length < 2;
  tablePick.innerHTML = own.map((t, k) => `<option value="${k}">${esc(t.headers.slice(0, 3).join(", "))}${t.headers.length > 3 ? "…" : ""} · ${t.rows.length} rows</option>`).join("");
  render(list.length, pages, Math.round(performance.now() - t0));
  setTimeout(() => setStep(null), 1400);
}

tablePick.addEventListener("change", () => {
  const f = files[0];
  const t = f.tables[Number(tablePick.value)];
  data = { ...t, totals: t.totals ?? [], files: t.rows.map(() => f.name) };
  kinds = columnKinds(data);
  f.layout = t.layout;
  f.rows = t.rows.length;
  sheet = null;
  baseName = `${f.name.replace(/\.pdf$/i, "")}-table-${Number(tablePick.value) + 1}`;
  renderFiles();
  setStatus(totalsNote(data));
  render(1, f.pages, 0);
});

/** Subtotal and total lines found in the table, and whether the rows add up to the printed grand total. */
function totalsNote(d: Dataset): string {
  const totals = d.totals ?? [];
  if (!totals.length) return "";
  const lines = `${totals.length} total line${totals.length > 1 ? "s" : ""} from the PDF ${totals.length > 1 ? "are" : "is"} set aside, so nothing is counted twice.`;
  if (files.length !== 1) return lines;
  const k = columnKinds(d);
  const grand = totals.at(-1)!;
  const checks = k
    .map((c, i) => ({ c, i, printed: c.kind === "number" ? numberIn(c, grand[i]) : null }))
    .filter((x) => x.printed !== null)
    .map(({ c, i, printed }) => {
      const sum = d.rows.reduce((s, r) => s + (numberIn(c, r[i]) ?? 0), 0);
      return Math.abs(sum - printed!) < 0.005 ? `The rows add up to the PDF's total for ${d.headers[i]} ✓` : "";
    })
    .filter(Boolean);
  return [lines, ...checks].join(" ");
}

function renderFiles() {
  $("files").innerHTML = files
    .map(
      (f) =>
        `<li class="file"><span class="file-ico" aria-hidden="true">PDF</span><span><b>${esc(f.name)}</b><small>${f.pages} page${f.pages === 1 ? "" : "s"} · ${f.skipped ? esc(f.skipped) : `${f.rows} rows`}</small></span></li>`,
    )
    .join("");
}

/* Result */
function render(fileCount: number, pages: number, ms: number) {
  const d = data!;
  $("doc-title").textContent = fileCount === 1 ? files[0].name : `${fileCount} files merged`;
  $("meta").textContent = `${pages} page${pages === 1 ? "" : "s"} · ${d.rows.length} row${d.rows.length === 1 ? "" : "s"} · ${d.headers.length} columns · extracted in ${ms} ms`;

  const cands = splitCandidates(d);
  split.innerHTML = `<option value="">Don't split</option>` + cands.map((c) => `<option value="${c.index}">${esc(d.headers[c.index])} (${c.unique} sheets)</option>`).join("");
  split.value = cands.length ? String(cands[0].index) : "";
  syncOptions();
  renderTable();
  if (!$("view-detect").hidden) renderDetect();
}

/** Column total for the footer; per-unit columns (price, rate) and percentages are not summed. */
function total(d: Dataset, idx: number[], col: number) {
  const k = kinds[col];
  if (k.kind !== "number" || PER_UNIT.test(d.headers[col])) return "";
  const values = idx.map((r) => numberIn(k, d.rows[r][col]) ?? 0);
  const decimals = values.some((v) => !Number.isInteger(Math.round(v * 1e6) / 1e6)) ? 2 : 0;
  const sum = values.reduce((s, v) => s + v, 0);
  // Written the way the document writes its numbers: 1,234.50 or 1.234,50.
  return sum.toLocaleString(k.decimal === "," ? "de-DE" : "en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function columnTypes() {
  return kinds.map((k) => (k.kind === "number" || k.kind === "percent" ? "num" : k.kind === "date" ? "date" : "text"));
}

function visibleRows(): number[] {
  const d = data!;
  if (sheet === null || split.value === "") return d.rows.map((_, i) => i);
  return groups(d, Number(split.value)).find(([name]) => name === sheet)?.[1] ?? [];
}

function renderTable() {
  const d = data!;
  const types = columnTypes();
  const icon = { num: "123", date: "D", text: "Aa" } as const;
  const idx = visibleRows();
  const shown = idx.slice(0, 250);

  const head = `<thead><tr><th class="idx" scope="col">#</th>${d.headers
    .map((h, i) => (types[i] === "num" ? `<th scope="col" class="num">${esc(h)}<span class="type" title="Number">${icon.num}</span></th>` : `<th scope="col"><span class="type" title="${types[i] === "date" ? "Date" : "Text"}">${icon[types[i] as "date" | "text"]}</span>${esc(h)}</th>`))
    .join("")}</tr></thead>`;
  const body = shown
    .map((r) => `<tr data-row="${r}"><td class="idx">${r + 1}</td>${d.rows[r].map((c, i) => `<td${types[i] === "num" ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  const more = idx.length > shown.length ? `<tr class="more"><td colspan="${d.headers.length + 1}">${idx.length - shown.length} more rows are in the export</td></tr>` : "";
  const hasNums = types.includes("num");
  const foot = hasNums
    ? `<tfoot><tr><td>Σ</td>${d.headers.map((_, i) => (types[i] === "num" ? `<td class="num">${total(d, idx, i)}</td>` : `<td>${i === 0 ? `${idx.length} rows` : ""}</td>`)).join("")}</tr></tfoot>`
    : "";
  table.innerHTML = head + `<tbody>${body}${more}</tbody>` + foot;
  renderSheets();
}

function renderSheets() {
  const d = data!;
  if (split.value === "") {
    sheetsBar.innerHTML = `<button type="button" role="tab" aria-selected="true">All rows<small>${d.rows.length}</small></button>`;
    return;
  }
  const g = groups(d, Number(split.value));
  const tab = (name: string | null, label: string, n: number) => `<button type="button" role="tab" aria-selected="${sheet === name}" data-sheet="${name === null ? "" : esc(name)}">${esc(label)}<small>${n}</small></button>`;
  sheetsBar.innerHTML = tab(null, "All rows", d.rows.length) + g.map(([name, rows]) => tab(name, name, rows.length)).join("") + (summary.checked ? `<button type="button" role="tab" aria-selected="false" disabled>Summary<small>sheet</small></button>` : "");
}

sheetsBar.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-sheet]");
  if (!b) return;
  sheet = b.dataset.sheet || null;
  renderTable();
});

function syncOptions() {
  summary.disabled = split.value === "";
  summary.parentElement!.classList.toggle("muted", summary.disabled);
  if (!data) return;
  const o = options();
  const n = o.splitBy === null ? 1 : 1 + groups(data, o.splitBy).length + (o.summary ? 1 : 0);
  $("sheets-note").textContent = `Workbook: ${n} sheet${n > 1 ? "s" : ""}, frozen header, filters and number formats.`;
}
split.addEventListener("change", () => {
  sheet = null;
  syncOptions();
  renderTable();
});
summary.addEventListener("change", () => {
  syncOptions();
  renderSheets();
});

function options() {
  return { splitBy: split.value === "" ? null : Number(split.value), summary: summary.checked, sourceColumns: source.checked, kinds };
}

$("xlsx").addEventListener("click", async () => {
  if (!data) return;
  const o = options();
  setStatus("Building workbook…");
  download(await buildWorkbook(data, o), `${baseName}.xlsx`);
  const sheets = 1 + (o.splitBy !== null ? groups(data, o.splitBy).length + (o.summary ? 1 : 0) : 0);
  setStatus(`Excel file ready: ${sheets} sheet${sheets > 1 ? "s" : ""}, ${data.rows.length} rows.`);
});
$("csv").addEventListener("click", () => data && download(buildCsv(data, options(), navigator.language), `${baseName}.csv`));

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* Views */
function show(view: "table" | "detect") {
  $("tab-table").setAttribute("aria-selected", String(view === "table"));
  $("tab-detect").setAttribute("aria-selected", String(view === "detect"));
  $("view-table").hidden = view !== "table";
  $("view-detect").hidden = view !== "detect";
  if (view === "detect") renderDetect();
}
$("tab-table").addEventListener("click", () => show("table"));
$("tab-detect").addEventListener("click", () => show("detect"));

/* Detection overlay */
const detectPages = () => files.flatMap((f, fi) => (f.layout ? Array.from({ length: f.pages }, (_, p) => ({ fi, page: p + 1 })) : []));

let renderToken = 0;
async function renderDetect() {
  const list = detectPages();
  if (!list.length) return;
  detectAt = Math.max(0, Math.min(detectAt, list.length - 1));
  const { fi, page } = list[detectAt];
  const f = files[fi];
  $("page-label").textContent = `${files.length > 1 ? `${f.name} · ` : ""}Page ${page} of ${f.pages}`;
  $<HTMLButtonElement>("prev").disabled = detectAt === 0;
  $<HTMLButtonElement>("next").disabled = detectAt === list.length - 1;

  const token = ++renderToken;
  $("overlay").innerHTML = "";
  const width = Math.min(760, $("page-wrap").clientWidth - 40);
  const { scale } = await renderPage(f.data, page, $<HTMLCanvasElement>("canvas"), width, f.password);
  if (token !== renderToken) return;

  const frame = f.frames[page - 1];
  const H = readingHeight(frame);
  const L = f.layout!;
  const onPage = L.lines.filter((l) => l.page === page);
  const firstRow = rowOffset(fi);
  const rows = onPage.filter((l) => l.kind !== "skipped");
  const top = rows.length ? Math.max(...rows.map((l) => l.y + l.h)) : 0;
  const bottom = rows.length ? Math.min(...rows.map((l) => l.y - l.h * 0.35)) : 0;
  // Drawn in reading coordinates (y down), then turned and scaled onto the page as displayed.
  const rect = (x0: number, y0: number, x1: number, y1: number, cls: string, title = "", attrs = "") =>
    `<rect class="${cls}" x="${x0.toFixed(1)}" y="${(H - y1).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(y1 - y0).toFixed(1)}" rx="2" ${attrs}>${title && `<title>${title}</title>`}</rect>`;

  let rowNo = rowsBefore(L, page);
  const svg = $("overlay");
  svg.setAttribute("viewBox", `0 0 ${width} ${frame.height * scale}`);
  svg.innerHTML =
    `<defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="rgb(120 124 132 / .08)"/><line x1="0" y1="0" x2="0" y2="4" stroke="rgb(120 124 132 / .45)" stroke-width="1.5"/></pattern></defs>` +
    `<g transform="matrix(${displayMatrix(frame).map((v) => +(v * scale).toFixed(4)).join(" ")})">` +
    (rows.length ? L.columns.map(([a, b]) => rect(a - 2, bottom, b + 2, top, "col")).join("") : "") +
    onPage
      .map((l) => {
        const box = (cls: string, title: string, attrs = "") => rect(l.x0 - 3, l.y - l.h * 0.3, l.x1 + 3, l.y + l.h * 0.9, cls, title, attrs);
        if (l.kind === "header") return box("header", "Header");
        if (l.kind === "skipped") return box("skipped", "Skipped: not part of the table");
        if (l.kind === "total") return box("total", "Total line: set aside, not counted twice");
        const n = firstRow + rowNo++;
        return box("row", `Row ${n + 1}`, `data-row="${n}"`);
      })
      .join("") +
    "</g>";
}

/** Rows extracted from files before `fi`, so overlay row numbers match the merged table. */
const rowOffset = (fi: number) => files.slice(0, fi).reduce((s, f) => s + f.rows, 0);
const rowsBefore = (L: Layout, page: number) => L.lines.filter((l) => l.page < page && l.kind === "row").length;

$("overlay").addEventListener("click", (e) => {
  const r = (e.target as Element).closest("[data-row]");
  if (!r) return;
  const n = Number(r.getAttribute("data-row"));
  sheet = null;
  show("table");
  renderTable();
  const tr = table.querySelector<HTMLTableRowElement>(`tr[data-row="${n}"]`);
  if (tr) {
    tr.scrollIntoView({ block: "center" });
    tr.classList.add("flash");
    setTimeout(() => tr.classList.remove("flash"), 1600);
  }
});
$("prev").addEventListener("click", () => (detectAt--, renderDetect()));
$("next").addEventListener("click", () => (detectAt++, renderDetect()));
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => !$("view-detect").hidden && renderDetect(), 150);
});

// Open on a real result instead of an empty form.
loadSample("store-orders-q3.pdf");
