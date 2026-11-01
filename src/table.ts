// Pure table-detection logic. It works on positioned text items, so it runs
// the same in the browser and in Node tests.

export interface TextItem {
  str: string;
  x: number; // left edge, PDF units
  y: number; // baseline, PDF units (grows upwards)
  width: number;
  height: number;
}

export interface PageText {
  page: number;
  items: TextItem[];
}

export interface Table {
  headers: string[];
  rows: string[][];
  source: { page: number }[];
  /** Where things were found, for drawing the detection overlay. PDF units. */
  layout?: Layout;
}

export interface Layout {
  columns: [number, number][];
  lines: { page: number; y: number; h: number; x0: number; x1: number; kind: "header" | "row" | "skipped" }[];
}

interface Word {
  text: string;
  x0: number;
  x1: number;
}

interface Line {
  y: number;
  h: number;
  words: Word[];
}

/**
 * Split pdf.js items into words with estimated positions and group them into
 * lines. pdf.js often merges neighbouring columns into one item (for example
 * "6,568.83 Paid"), so we work at word level and find the columns afterwards.
 */
export function toLines(items: TextItem[]): Line[] {
  const words: (Word & { y: number; h: number })[] = [];
  for (const it of items) {
    if (!it.str.trim() || it.width <= 0) continue;
    const cw = it.width / it.str.length;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(it.str))) {
      words.push({ text: m[0], x0: it.x + m.index * cw, x1: it.x + (m.index + m[0].length) * cw, y: it.y, h: it.height || 8 });
    }
  }
  words.sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines: { y: number; h: number; words: Word[] }[] = [];
  for (const w of words) {
    const line = lines.find((l) => Math.abs(l.y - w.y) <= Math.max(2, Math.min(l.h, w.h) * 0.45));
    if (line) line.words.push(w);
    else lines.push({ y: w.y, h: w.h, words: [w] });
  }
  return lines.sort((a, b) => b.y - a.y).map((l) => ({ y: l.y, h: l.h, words: l.words.sort((a, b) => a.x0 - b.x0) }));
}

/** Columns are the x ranges covered by text, split by strips covered by at most `limit` lines. */
function columnsFrom(lines: Line[], limit: number): [number, number][] {
  const minX = Math.floor(Math.min(...lines.map((l) => l.words[0].x0)));
  const maxX = Math.ceil(Math.max(...lines.map((l) => l.words[l.words.length - 1].x1)));
  const cover = new Array(maxX - minX + 1).fill(0);
  for (const l of lines) {
    const seen = new Set<number>();
    for (const w of l.words) for (let x = Math.floor(w.x0); x < Math.ceil(w.x1); x++) seen.add(x - minX);
    seen.forEach((i) => cover[i]++);
  }
  const cols: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= cover.length; i++) {
    const filled = i < cover.length && cover[i] > limit;
    if (filled && start < 0) start = i;
    if (!filled && start >= 0) {
      cols.push([start + minX, i - 1 + minX]);
      start = -1;
    }
  }
  return cols;
}

export const crosses = (l: Line, cols: [number, number][]) =>
  l.words.some((w) => cols.some(([, end], i) => i < cols.length - 1 && w.x0 < end && w.x1 > cols[i + 1][0]));

/**
 * Find columns from gutters: vertical strips that no table row puts text in.
 * Word gaps inside a cell move from row to row, real column gaps do not.
 * Titles and footers run across the gutters, so they are found and set aside
 * first, then the gutters are recomputed strictly from the remaining rows.
 */
export function findColumns(lines: Line[]): [number, number][] {
  let rows = lines.filter((l) => l.words.length >= 2);
  if (rows.length < 3) return [];
  for (let pass = 0; pass < 3; pass++) {
    const loose = columnsFrom(rows, Math.floor(rows.length * 0.05));
    const keep = rows.filter((l) => !crosses(l, loose));
    if (keep.length === rows.length || keep.length < rows.length * 0.6) break;
    rows = keep;
  }
  return columnsFrom(rows, 0);
}

function rowOf(line: Line, cols: [number, number][]): string[] {
  const row = new Array(cols.length).fill("");
  for (const w of line.words) {
    const c = (w.x0 + w.x1) / 2;
    let best = 0;
    let dist = Infinity;
    cols.forEach(([a, b], i) => {
      const d = c < a ? a - c : c > b ? c - b : 0;
      if (d < dist) { dist = d; best = i; }
    });
    row[best] = row[best] ? `${row[best]} ${w.text}` : w.text;
  }
  return row;
}

/** True when every word sits inside a column, as table rows do by construction. */
const onGrid = (l: Line, cols: [number, number][]) =>
  l.words.every((w) => {
    const c = (w.x0 + w.x1) / 2;
    return cols.some(([a, b]) => c >= a - 1.5 && c <= b + 1.5);
  });

/**
 * A multi-word value that is longer than every other value in its column
 * ("New York 5th Ave") leaves a gap only it uses, which looks like a gutter.
 * Such a "column" is narrow-gapped and mostly empty: fold it into its left
 * neighbour. A real column next to a tight gap is filled on most rows.
 */
function mergeContinuations(lines: Line[], cols: [number, number][], fontSize: number): [number, number][] {
  const grid = lines.filter((l) => onGrid(l, cols) && l.words.length >= 2);
  const filled = (l: Line, [a, b]: [number, number]) => l.words.some((w) => (w.x0 + w.x1) / 2 >= a - 1.5 && (w.x0 + w.x1) / 2 <= b + 1.5);
  const out: [number, number][] = [cols[0]];
  for (let j = 1; j < cols.length; j++) {
    const prev = out[out.length - 1];
    const gap = cols[j][0] - prev[1];
    const uses = grid.filter((l) => filled(l, cols[j]));
    const sparse = uses.length < grid.length * 0.6;
    const alwaysAfterPrev = uses.every((l) => filled(l, prev));
    if (gap < fontSize * 0.5 && sparse && alwaysAfterPrev) prev[1] = cols[j][1];
    else out.push([...cols[j]] as [number, number]);
  }
  return out;
}

/** Cells of a line: runs of words separated by a gap wider than normal word spacing. */
function cellsOf(l: Line, fontSize: number): [number, number][] {
  const cells: [number, number][] = [[l.words[0].x0, l.words[0].x1]];
  for (let i = 1; i < l.words.length; i++) {
    if (l.words[i].x0 - l.words[i - 1].x1 > fontSize * 0.6) cells.push([l.words[i].x0, l.words[i].x1]);
    else cells[cells.length - 1][1] = l.words[i].x1;
  }
  return cells;
}

/**
 * Splits the document into blocks that could each hold one table. A block
 * ends at running prose (one long cell of many words), at a large vertical gap,
 * or where the cells stop lining up with the rows above (a key/value box above
 * a table, a totals box below it). Cells line up by their left edge, or with
 * `edges: "either"` also by their right edge, as right-aligned numbers do. Page breaks do not end a block, so tables continue across pages.
 */
function blocks(pageLines: Line[][], fontSize: number, edges: "left" | "either"): Line[][][] {
  const width = Math.max(1, ...pageLines.flat().map((l) => l.words.at(-1)!.x1 - l.words[0].x0));
  const out: Line[][][] = [];
  let current: Line[][] = pageLines.map(() => []);
  let recent: [number, number][][] = [];
  let prevY: number | null = null;
  let lastGap: number | null = null;
  const flush = () => {
    // Titles above a table and notes below it are single cells that would bridge the gutters.
    const all = current.flat();
    let first = all.findIndex((l) => cellsOf(l, fontSize).length >= 2);
    // …but keep a short label right above the first row: the top half of a wrapped header.
    if (first > 0 && all[first - 1].words.length <= 3 && all[first - 1].y - all[first].y < all[first].h * 1.8) first--;
    let last = all.length - 1;
    while (first >= 0 && last > first && cellsOf(all[last], fontSize).length < 2 && all[last - 1].y - all[last].y > all[last].h * 1.8) last--;
    const keep = new Set(first === -1 ? [] : all.slice(first, last + 1));
    current = current.map((ls) => ls.filter((l) => keep.has(l)));
    if (current.flat().length >= 2) out.push(current);
    current = pageLines.map(() => []);
    recent = [];
    prevY = null;
    lastGap = null;
  };
  pageLines.forEach((lines, p) => {
    prevY = null;
    lastGap = null;
    for (const l of lines) {
      const cells = cellsOf(l, fontSize);
      const prose = cells.length === 1 && l.words.length >= 6 && l.words.at(-1)!.x1 - l.words[0].x0 > width * 0.45;
      if (prose) {
        flush();
        continue;
      }
      const gap = prevY === null ? 0 : prevY - l.y;
      // Rows can be widely spaced; what ends a table is a gap clearly larger than its own rhythm.
      const unusual = lastGap === null ? gap > fontSize * 3.2 : gap > fontSize * 2 && gap > lastGap * 1.7;
      // A cell lines up with the rows above when its left or right edge does (text or numbers).
      const multi = recent.filter((r) => r.length >= 2);
      const tol = fontSize * 0.5;
      const aligned = ([a, b]: [number, number]) => multi.some((r) => r.some(([c, d]) => Math.abs(a - c) <= tol || (edges === "either" && Math.abs(b - d) <= tol)));
      const matched = cells.filter(aligned).length;
      const shifted = cells.length >= 2 && (edges === "either" ? multi.length >= 1 && matched < cells.length * 0.75 : multi.length >= 2 && matched < Math.ceil(cells.length / 2));
      if (unusual || shifted) {
        // A short label hugging this line is the top half of its wrapped header: take it along.
        const label = current[p].at(-1);
        const carry = shifted && label && label.words.length <= 3 && cellsOf(label, fontSize).length === 1 && label.y - l.y < l.h * 1.8;
        if (carry) current[p].pop();
        flush();
        if (carry) current[p].push(label);
      }
      current[p].push(l);
      recent = [...recent.slice(-3), cells];
      lastGap = prevY === null ? null : gap;
      prevY = l.y;
    }
  });
  flush();
  return out;
}

const score = (t: Table) => {
  const numeric = numericColumns(t).length > 0 ? 1.5 : 1;
  const named = t.headers.some((h) => !/^Column \d+$/.test(h)) ? 2 : 1;
  const filled = t.rows.flat().filter(Boolean).length / Math.max(1, t.rows.flat().length);
  return t.rows.length * t.headers.length * numeric * named * filled;
};

/**
 * Finds the main table: every block is read on its own and the whole document
 * as one, and the most table-like result wins (rows × columns, a named header,
 * numeric columns and filled cells all count).
 */
export function extractTable(pages: PageText[]): Table | null {
  const pageLines = pages.map((p) => toLines(p.items));
  const heights = pages.flatMap((p) => p.items.filter((i) => i.str.trim() && i.height > 0).map((i) => i.height)).sort((a, b) => a - b);
  const fontSize = heights[Math.floor(heights.length / 2)] || 10;
  // Left-aligned text tables and right-aligned number columns split best in different ways: try both.
  const candidates = [pageLines, ...blocks(pageLines, fontSize, "left"), ...blocks(pageLines, fontSize, "either")]
    .map((ls) => tableFrom(ls, pages, fontSize))
    .filter((t): t is Table => t !== null && t.rows.length >= 2);
  if (!candidates.length) return null;
  return candidates.reduce((best, t) => (score(t) > score(best) ? t : best));
}

/** Reads one table from the given lines (one array per page) with gutter-based columns. */
function tableFrom(pageLines: Line[][], pages: PageText[], fontSize: number): Table | null {
  const raw = findColumns(pageLines.flat());
  if (raw.length < 2) return null;
  const cols = mergeContinuations(pageLines.flat(), raw, fontSize);
  if (cols.length < 2) return null;
  const minFilled = Math.max(2, Math.ceil(cols.length * 0.6));

  // Body rows: on the column grid and reasonably filled. Titles, notes, page
  // footers and repeated headers fall between the columns and are skipped.
  const rows: string[][] = [];
  const source: { page: number }[] = [];
  const marks: (Layout["lines"][number] & { row?: number })[] = [];
  let header: string[] | null = null;
  let skipHeaderTail: Line | undefined;
  pageLines.forEach((lines, idx) => {
    const page = pages[idx].page;
    const mark = (line: Line, kind: Layout["lines"][number]["kind"], row?: number) =>
      marks.push({ page, y: line.y, h: line.h, x0: line.words[0].x0, x1: line.words[line.words.length - 1].x1, kind, row });
    lines.forEach((line, i) => {
      if (line === skipHeaderTail) {
        mark(line, "header");
        return;
      }
      const cells = onGrid(line, cols) ? rowOf(line, cols) : null;
      // A wrapped cell ("…improved after the" / "September escalation.") continues the row above.
      const prev = lines[i - 1];
      const lastRow = rows.at(-1);
      if (cells && lastRow && header && prev && marks.at(-1)?.kind === "row" && marks.at(-1)?.y === prev.y && prev.y - line.y < line.h * 1.8 && cells.filter(Boolean).length < minFilled && cells.every((c, k) => !c || lastRow[k])) {
        cells.forEach((c, k) => c && (lastRow[k] = `${lastRow[k]} ${c}`));
        mark(line, "row", rows.length - 1);
        return;
      }
      if (!cells || cells.filter(Boolean).length < minFilled) {
        if (marks.at(-1)?.y !== line.y || marks.at(-1)?.page !== page) mark(line, "skipped");
        return;
      }
      if (!header) {
        // The header is the first grid line if it has no numbers, otherwise the
        // line right above it (header labels are often wider than the data).
        const above = lines[i - 1];
        if (!cells.some((c) => /\d/.test(c))) {
          // Header labels can wrap ("Receipt" / "No"): fold label-only lines right above and below into the header.
          const labelLine = (l: Line | undefined) => l && Math.abs(l.y - line.y) < line.h * 1.8 && onGrid(l, cols) && !l.words.some((w) => /\d/.test(w.text)) && l.words.length <= cols.length;
          const above = lines[i - 1];
          const below = lines[i + 1];
          header = cells;
          if (labelLine(above)) header = rowOf(above, cols).map((c, k) => [c, header![k]].filter(Boolean).join(" "));
          if (labelLine(below)) {
            header = header.map((c, k) => [c, rowOf(below, cols)[k]].filter(Boolean).join(" "));
            skipHeaderTail = below;
          }
          mark(line, "header");
          return;
        }
        if (above && above.words.length >= minFilled) {
          header = rowOf(above, cols);
          const last = marks.at(-1);
          if (last && last.page === page && last.y === above.y) last.kind = "header";
        } else header = cols.map((_, k) => `Column ${k + 1}`);
      }
      mark(line, "row", rows.length);
      rows.push(cells);
      source.push({ page });
    });
  });
  if (!header || rows.length < 1) return null;
  const headers = (header as string[]).map((h, k) => h || `Column ${k + 1}`);
  // A header repeated on every page can still slip through as a row.
  const key = headers.map(norm).join("|");
  const keep = rows.map((r, k) => (r.map(norm).join("|") === key ? -1 : k)).filter((k) => k >= 0);
  const repeated = new Set(rows.map((_, k) => k).filter((k) => !keep.includes(k)));
  const lines = marks.map(({ row, ...m }) => (row !== undefined && repeated.has(row) ? { ...m, kind: "header" as const } : m));
  return { headers, rows: keep.map((k) => rows[k]), source: keep.map((k) => source[k]), layout: { columns: cols, lines } };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Columns worth splitting on: a handful of repeated values (e.g. Branch, Store). */
export function splitCandidates(t: Table): { index: number; unique: number }[] {
  return t.headers
    .map((_, index) => ({ index, unique: new Set(t.rows.map((r) => r[index])).size }))
    .filter((c) => c.unique >= 2 && c.unique <= 30 && c.unique < t.rows.length / 2);
}

/** Parse "1,234.50", "€12", "(45.00)" into a number, or null if the text is not numeric. */
export function toNumber(s: string): number | null {
  const t = s.replace(/[\s$€£₺¥]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!/^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t.replace(/,/g, ""));
}

/** Numeric columns, excluding identifier-like ones such as "No" or "Order". */
export function numericColumns(t: Table): number[] {
  return t.headers
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => t.rows.length > 0 && t.rows.every((r) => r[i] === "" || toNumber(r[i]) !== null))
    .filter(({ h, i }) => !/^(no|#|id|order|index|row)\b/i.test(h.trim()) && !t.rows.every((r, k) => toNumber(r[i]) === k + 1))
    .map(({ i }) => i);
}
