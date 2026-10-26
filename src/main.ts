import "./style.css";
import { readPdf } from "./pdf";
import { extractTable, splitCandidates, numericColumns } from "./table";
import { buildWorkbook, buildCsv, groups, type Dataset } from "./export";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const drop = $("drop"), input = $<HTMLInputElement>("file"), status = $("status");
const result = $("result"), split = $<HTMLSelectElement>("split");
const summary = $<HTMLInputElement>("summary"), source = $<HTMLInputElement>("source");

let data: Dataset | null = null;
let baseName = "extracted";

$("pick").addEventListener("click", () => input.click());
input.addEventListener("change", () => input.files && handle([...input.files]));

drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (files.length) handle(files);
  else setStatus("Please drop PDF files.", true);
});

document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((b) =>
  b.addEventListener("click", async () => {
    const name = b.dataset.sample!;
    setStatus(`Loading ${name}…`);
    const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
    handle([new File([await res.blob()], name, { type: "application/pdf" })]);
  }),
);

function setStatus(msg: string, error = false) {
  status.textContent = msg;
  status.classList.toggle("error", error);
}

async function handle(files: File[]) {
  result.hidden = true;
  const merged: Dataset = { headers: [], rows: [], source: [], files: [] };
  const skipped: string[] = [];
  let pages = 0;

  for (const [n, file] of files.entries()) {
    setStatus(`Reading ${file.name} (${n + 1}/${files.length})…`);
    try {
      const text = await readPdf(await file.arrayBuffer());
      pages += text.length;
      const t = extractTable(text);
      if (!t || t.rows.length === 0) { skipped.push(`${file.name} (no table found)`); continue; }
      if (merged.headers.length && t.headers.join("|") !== merged.headers.join("|")) {
        skipped.push(`${file.name} (different columns)`);
        continue;
      }
      merged.headers = t.headers;
      merged.rows.push(...t.rows);
      merged.source.push(...t.source);
      merged.files.push(...t.rows.map(() => file.name));
    } catch {
      skipped.push(`${file.name} (could not be read)`);
    }
  }

  if (!merged.rows.length) {
    setStatus(
      "No table was found. This works with digital PDFs whose text can be selected. Scanned PDFs need OCR first.",
      true,
    );
    return;
  }

  data = merged;
  baseName = files.length === 1 ? files[0].name.replace(/\.pdf$/i, "") : "merged-tables";
  setStatus(skipped.length ? `Done. Skipped: ${skipped.join(", ")}.` : "");
  render(files.length, pages);
}

function render(fileCount: number, pages: number) {
  const d = data!;
  const stat = (v: string | number, l: string) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  $("stats").innerHTML =
    stat(fileCount, fileCount === 1 ? "file" : "files") + stat(pages, "pages") + stat(d.rows.length, "rows") + stat(d.headers.length, "columns");

  const cands = splitCandidates(d);
  split.innerHTML = `<option value="">Don't split</option>` +
    cands.map((c) => `<option value="${c.index}">${esc(d.headers[c.index])} (${c.unique} sheets)</option>`).join("");
  split.value = cands.length ? String(cands[0].index) : "";
  syncSummary();

  const table = $<HTMLTableElement>("preview");
  const shown = d.rows.slice(0, 100);
  table.innerHTML =
    `<thead><tr>${d.headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${shown.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  $("preview-note").textContent = d.rows.length > shown.length ? `First ${shown.length} of ${d.rows.length} rows` : `${d.rows.length} rows`;
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncSummary() {
  summary.disabled = split.value === "";
  summary.parentElement!.classList.toggle("muted", summary.disabled);
}
split.addEventListener("change", syncSummary);

function options() {
  return {
    splitBy: split.value === "" ? null : Number(split.value),
    summary: summary.checked,
    sourceColumns: source.checked,
    numbers: numericColumns(data!),
  };
}

$("xlsx").addEventListener("click", async () => {
  if (!data) return;
  const o = options();
  setStatus("Building workbook…");
  download(await buildWorkbook(data, o), `${baseName}.xlsx`);
  const sheets = 1 + (o.splitBy !== null ? groups(data, o.splitBy).length + (o.summary ? 1 : 0) : 0);
  setStatus(`Excel file ready: ${sheets} sheet${sheets > 1 ? "s" : ""}, ${data.rows.length} rows.`);
});
$("csv").addEventListener("click", () => data && download(buildCsv(data, options()), `${baseName}.csv`));

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
