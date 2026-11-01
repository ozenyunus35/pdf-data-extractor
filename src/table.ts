// Pure table-detection logic. It works on positioned text items, so it runs
// the same in the browser and in Node tests.

import { dateOrderOf, decimalOf, isPercent, isUnit, toDate, toNumber, type Decimal } from "./values.ts";

export { toNumber } from "./values.ts";

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
  /** Subtotal and total lines printed inside the table, set aside so they are not counted twice. */
  totals?: string[][];
  /** Where things were found, for drawing the detection overlay. PDF units. */
  layout?: Layout;
}

export interface Layout {
  columns: [number, number][];
  lines: { page: number; y: number; h: number; x0: number; x1: number; kind: "header" | "row" | "total" | "skipped" }[];
}

interface Word {
  text: string;
  x0: number;
  x1: number;
  /** Written in the same text run as the word before it, one space apart. */
  glued?: boolean;
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
    // NFKC turns ligatures ("ﬁ") and CJK compatibility forms ("⾦") into ordinary letters.
    const str = it.str.normalize("NFKC");
    if (!str.trim() || it.width <= 0) continue;
    const cw = it.width / str.length;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    let prev: (Word & { y: number; h: number }) | undefined;
    while ((m = re.exec(str))) {
      const x0 = it.x + m.index * cw, x1 = it.x + (m.index + m[0].length) * cw;
      // Keep a number with its unit ("6.497,76 €", "15,0 %") and with its space-grouped thousands ("229 402,18").
      if (prev && str.slice(m.index - 1, m.index) === " " && (joinsNumber(prev.text, m[0]) || (isUnit(prev.text) && /^[-(]?\d/.test(m[0])))) {
        prev.text += ` ${m[0]}`;
        prev.x1 = x1;
        continue;
      }
      prev = { text: m[0], x0, x1, y: it.y, h: it.height || 8, glued: !!prev && str.slice(m.index - 1, m.index) === " " && str[m.index - 2] !== " " };
      words.push(prev);
    }
  }
  words.sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines: { y: number; h: number; words: Word[] }[] = [];
  for (const w of words) {
    const line = lines.find((l) => Math.abs(l.y - w.y) <= Math.max(2, Math.min(l.h, w.h) * 0.45));
    if (line) line.words.push(w);
    else lines.push({ y: w.y, h: w.h, words: [w] });
  }
  return lines.sort((a, b) => b.y - a.y).map((l) => {
    const sorted = l.words.sort((a, b) => a.x0 - b.x0);
    // Glyphs drawn edge to edge are one word: CJK characters, ligatures split from their word ("pro" "fi" "t").
    const merged: Word[] = [];
    for (const w of sorted) {
      const last = merged.at(-1);
      if (last && w.x0 - last.x1 < l.h * 0.12 && w.x0 >= last.x0) {
        last.text += w.text;
        last.x1 = Math.max(last.x1, w.x1);
      } else if (last && w.x0 - last.x1 < l.h * 0.7 && w.x0 >= last.x0 && joinsNumber(last.text, w.text)) {
        // Monospaced text arrives word by word: "81" "189,70" one space apart is still one number.
        last.text += ` ${w.text}`;
        last.x1 = Math.max(last.x1, w.x1);
      } else merged.push({ ...w });
    }
    return { y: l.y, h: l.h, words: merged };
  });
}

/** "229" + "402,18" is one number grouped by a space; "15,0" + "%" and "12" + "TL" carry their unit. */
const joinsNumber = (a: string, b: string) =>
  (/^[-(]?\d+([.,]\d+)?$/.test(a) && isUnit(b.replace(/\)$/, ""))) || (/^[-(]?\d{1,3}( \d{3})*$/.test(a) && /^\d{3}(,\d+)?\)?-?$/.test(b));

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
  // Titles set larger than the body never say where columns are.
  const hs = lines.map((l) => l.h).sort((a, b) => a - b);
  const body = hs[Math.floor(hs.length / 2)] ?? 0;
  let rows = lines.filter((l) => l.words.length >= 2 && l.h <= body * 1.3);
  if (rows.length < 3) return [];
  for (let pass = 0; pass < 3; pass++) {
    const loose = columnsFrom(rows, Math.floor(rows.length * 0.05));
    // Titles and notes either bridge a gutter or sit in one where no row writes.
    // A sentence (one run of words, no cell gaps) reaching into a gutter is a title or note, not a row.
    const inGutter = (w: Word) => !loose.some(([a, b]) => w.x0 >= a - 1 && w.x1 <= b + 1);
    const keep = rows.filter((l) => !crosses(l, loose) && !(loose.length && l.words.some((w) => !loose.some(([a, b]) => w.x0 < b + 1 && w.x1 > a - 1))) && !(loose.length && cellsOf(l, l.h).length < 2 && l.words.some(inGutter)));
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
    // The tail of one value is written in the same run as its start, one space after it.
    const tail = uses.length > 0 && uses.every((l) => l.words.find((w) => (w.x0 + w.x1) / 2 >= cols[j][0] - 1.5)?.glued);
    if ((gap < fontSize * 0.5 || tail) && sparse && alwaysAfterPrev) prev[1] = cols[j][1];
    else out.push([...cols[j]] as [number, number]);
  }
  return out;
}

/**
 * Folds columns that are really part of their neighbour: a column of currency or
 * percent signs printed apart from the numbers ("6.497,76" | "€"), and two "columns"
 * that every row writes with no more than a word space between them ("Ana" | "Lee").
 */
function foldColumns(lines: Line[], cols: [number, number][], fontSize: number): [number, number][] {
  const grid = lines.filter((l) => onGrid(l, cols) && l.words.length >= 2);
  const wordsIn = (l: Line, [a, b]: [number, number]) => l.words.filter((w) => (w.x0 + w.x1) / 2 >= a - 1.5 && (w.x0 + w.x1) / 2 <= b + 1.5);
  const out: [number, number][] = [[...cols[0]] as [number, number]];
  for (let j = 1; j < cols.length; j++) {
    const prev = out[out.length - 1];
    const both = grid.filter((l) => wordsIn(l, prev).length && wordsIn(l, cols[j]).length);
    const units = grid.map((l) => wordsIn(l, cols[j])).filter((ws) => ws.length);
    const unitColumn = units.length >= 2 && units.every((ws) => ws.length === 1 && isUnit(ws[0].text)) && cols[j][0] - prev[1] < fontSize * 1.2;
    // pdf.js can run neighbouring cells into one text run ("6,568.83 Paid"), so only text next to text counts.
    // Two real columns each carry a label in the header; a value's second word has none above it.
    const top = grid.find((l) => (wordsIn(l, prev).length || wordsIn(l, cols[j]).length) && !l.words.some((w) => /\d/.test(w.text)));
    const unlabelled = !!top && wordsIn(top, prev).length > 0 && wordsIn(top, cols[j]).length === 0;
    const wordSpace = unlabelled && both.length >= 3 && both.every((l) => {
      const [a, b] = [wordsIn(l, prev).at(-1)!, wordsIn(l, cols[j])[0]];
      return (b.glued || b.x0 - a.x1 < fontSize * 0.15) && !isFigure(a.text) && !isFigure(b.text);
    });
    if (unitColumn || wordSpace) prev[1] = cols[j][1];
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
  // A key/value box ("Rechnungsnummer:  RE-26-1187") has labels ending in a colon, not a header.
  const keyValue = t.headers.some((h) => /:$/.test(h.trim())) ? 0.5 : 1;
  // Columns count for more than rows: two columns of anything line up by chance far more often than four.
  return t.rows.length * t.headers.length ** 1.5 * numeric * named * filled * keyValue;
};

/** "Page 3 of 12", "Seite 3 von 12", "Sayfa 3/12", "3 / 12", "- 3 -". */
const PAGE_NO = /^(?:(?:page|seite|sayfa|página|pagina|strona|side|sida|blad|pag\.?|p\.)\s*\d+(?:\s*(?:of|von|de|di|z|av|af|\/)\s*\d+)?|\d+\s*(?:\/|of|von)\s*\d+|[-–]\s*\d+\s*[-–])$/i;

/**
 * Page furniture: page numbers, and running headers and footers repeated at the same
 * place on most pages. Left in, a centred "Page 1 of 3" opens a column of its own.
 */
function withoutFurniture(pageLines: Line[][]): Line[][] {
  const text = (l: Line) => l.words.map((w) => w.text).join(" ");
  const key = (l: Line) => `${Math.round(l.y / 3)}|${text(l).replace(/\d+/g, "#")}`;
  const seen = new Map<string, number>();
  pageLines.forEach((lines) => new Set(lines.map(key)).forEach((k) => seen.set(k, (seen.get(k) ?? 0) + 1)));
  const repeated = (l: Line) => pageLines.length >= 2 && (seen.get(key(l)) ?? 0) >= Math.max(2, pageLines.length * 0.6);
  return pageLines.map((lines) => {
    const kept = lines.filter((l) => !PAGE_NO.test(text(l)));
    // Running headers and footers sit in the margins, set apart from the body by more than its line spacing.
    // A table header repeated on every page is not furniture: the rows follow it at their usual spacing.
    const gaps = kept.slice(1).map((l, k) => kept[k].y - l.y).sort((a, b) => a - b);
    const usual = gaps[Math.floor(gaps.length / 2)] ?? 0;
    const apart = (a: Line, b: Line) => Math.abs(a.y - b.y) > usual * 2;
    while (kept.length > 2 && repeated(kept[0]) && apart(kept[0], kept[1])) kept.shift();
    while (kept.length > 2 && repeated(kept.at(-1)!) && apart(kept.at(-1)!, kept.at(-2)!)) kept.pop();
    return kept;
  });
}

/**
 * Finds the tables in a document, most table-like first: every block is read on its
 * own and the whole document as one, and rows × columns, a named header, numeric
 * columns and filled cells all count. Tables after the first share no line with it.
 */
export function extractTables(pages: PageText[]): Table[] {
  const pageLines = withoutFurniture(pages.map((p) => toLines(p.items)));
  const heights = pages.flatMap((p) => p.items.filter((i) => i.str.trim() && i.height > 0).map((i) => i.height)).sort((a, b) => a - b);
  const fontSize = heights[Math.floor(heights.length / 2)] || 10;
  // Left-aligned text tables and right-aligned number columns split best in different ways: try both.
  const candidates = [pageLines, ...blocks(pageLines, fontSize, "left"), ...blocks(pageLines, fontSize, "either")]
    .map((ls) => tableFrom(ls, pages, fontSize))
    .filter((t): t is Table => t !== null && t.rows.length >= 2)
    .sort((a, b) => score(b) - score(a));
  const used = (t: Table) => new Set(t.layout!.lines.filter((l) => l.kind !== "skipped").map((l) => `${l.page}|${l.y.toFixed(1)}`));
  const picked: { t: Table; lines: Set<string> }[] = [];
  for (const t of candidates) {
    const lines = used(t);
    if (picked.some((p) => [...lines].some((l) => p.lines.has(l)))) continue;
    if (picked.length && !t.headers.some((h) => !/^Column \d+$/.test(h))) continue;
    picked.push({ t, lines });
    if (picked.length === 6) break;
  }
  return picked.map((p) => p.t);
}

/** The main table of a document, or null when there is none. */
export const extractTable = (pages: PageText[]): Table | null => extractTables(pages)[0] ?? null;

/** Reads one table from the given lines (one array per page) with gutter-based columns. */
function tableFrom(pageLines: Line[][], pages: PageText[], fontSize: number): Table | null {
  const raw = findColumns(pageLines.flat());
  if (raw.length < 2) return null;
  const cols = foldColumns(pageLines.flat(), mergeContinuations(pageLines.flat(), raw, fontSize), fontSize);
  if (cols.length < 2) return null;
  const minFilled = Math.max(2, Math.ceil(cols.length * 0.6));
  const heights = pageLines.flat().map((l) => l.h).sort((a, b) => a - b);
  const bodyHeight = heights[Math.floor(heights.length / 2)];

  // Body rows: on the column grid and reasonably filled. Titles, notes, page
  // footers and repeated headers fall between the columns and are skipped.
  const rows: string[][] = [];
  const source: { page: number }[] = [];
  const marks: (Layout["lines"][number] & { row?: number })[] = [];
  let header: string[] | null = null;
  const headerTail = new Set<Line>();
  let prefix: string[] | null = null;
  const full = (l: Line | undefined) => !!l && onGrid(l, cols) && l.h <= bodyHeight * 1.3 && rowOf(l, cols).filter(Boolean).length >= minFilled;
  pageLines.forEach((lines, idx) => {
    const page = pages[idx].page;
    const mark = (line: Line, kind: Layout["lines"][number]["kind"], row?: number) =>
      marks.push({ page, y: line.y, h: line.h, x0: line.words[0].x0, x1: line.words[line.words.length - 1].x1, kind, row });
    lines.forEach((line, i) => {
      if (headerTail.has(line)) {
        mark(line, "header");
        return;
      }
      // A title set larger than the table's text is never a row or the header, even when its words fall on the grid.
      // Above the header, a sentence whose word space happens to fall in a gutter ("Generated for Cedar · de-DE")
      // is a subtitle, not a row: real cells are not one run of text split by an ordinary space.
      // Below it, a note running over several columns that way is a sentence; one such join can be pdf.js
      // running two tight cells together.
      const sentence = line.words.length >= 6 && line.words.slice(1).every((w) => w.glued) && bridges(line, cols);
      const cells = onGrid(line, cols) && line.h <= bodyHeight * 1.3 && !sentence && !bridges(line, cols, header ? 2 : 1) ? rowOf(line, cols) : null;
      // A cell wrapped in a row whose other cells are centred: its first line sits above the row's line, nearer
      // to it than to the row before, and starts the row's cell.
      const next = lines[i + 1];
      const lastMark = marks.at(-1);
      const above = lastMark?.kind === "row" && lastMark.page === page ? lastMark.y - line.y : Infinity;
      const below = full(next) ? line.y - next.y : Infinity;
      if (cells && header && cells.filter(Boolean).length < minFilled && below < above && below < line.h * 1.8 && cells.every((c) => !c || !isFigure(c))) {
        prefix = prefix ? prefix.map((c, k) => join(c, cells[k])) : cells;
        mark(line, "row", rows.length);
        return;
      }
      // A wrapped cell ("…improved after the" / "September escalation.") continues the row above.
      const prev = lines[i - 1];
      const lastRow = rows.at(-1);
      if (cells && lastRow && header && prev && marks.at(-1)?.kind === "row" && marks.at(-1)?.y === prev.y && prev.y - line.y < line.h * 1.8 && cells.filter(Boolean).length < minFilled && cells.every((c, k) => !c || (lastRow[k] && !isFigure(lastRow[k])))) {
        cells.forEach((c, k) => c && (lastRow[k] = join(lastRow[k], c)));
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
        if (cells.every(isLabel) && cells.some((c) => /\p{L}/u.test(c) || PERIOD.test(c))) {
          // Header labels can wrap over several lines ("Quantity" / "on hand" / "(units)"): fold label-only lines
          // right above and below into the header. Lines set closer than the rows are one header even when wordy.
          const gaps = lines.slice(1).map((l, k) => lines[k].y - l.y).sort((a, b) => a - b);
          const pitch = gaps[Math.floor(gaps.length / 2)] ?? line.h * 2;
          // A label line is set in the header's own type size, closer than the rows are to each other: a text-only
          // first row ("Ava  Germany  Paid") sits a full row away, and a page title is set larger.
          const labelLine = (l: Line | undefined, next: Line) => {
            if (!l || !onGrid(l, cols) || !rowOf(l, cols).every(isLabel)) return false;
            const gap = Math.abs(l.y - next.y);
            const partial = rowOf(l, cols).filter(Boolean).length < minFilled;
            return gap < next.h * 1.8 && (partial || gap < pitch * 0.85) && l.h < next.h * 1.25 && l.h > next.h * 0.8;
          };
          header = cells;
          let top = line;
          // Above the header only a label in the header's own tight spacing counts; a subtitle is a paragraph away.
          for (let k = i - 1; k >= 0 && labelLine(lines[k], top) && top.y - lines[k].y > -pitch * 0.85 && lines[k].y - top.y < pitch * 0.85 && !bridges(lines[k], cols); k--) {
            top = lines[k];
            header = rowOf(top, cols).map((c, n) => [c, header![n]].filter(Boolean).join(" "));
            const last = marks.at(-1);
            if (last && last.page === page && last.y === top.y) last.kind = "header";
          }
          // …but not the first half of a wrapped cell, which sits nearer to its own row than to the header.
          const ownRow = (k: number) => full(lines[k + 1]) && lines[k].y - lines[k + 1].y < lines[k - 1].y - lines[k].y;
          for (let k = i + 1, bottom = line; labelLine(lines[k], bottom) && !ownRow(k); bottom = lines[k++]) {
            header = header.map((c, n) => [c, rowOf(lines[k], cols)[n]].filter(Boolean).join(" "));
            headerTail.add(lines[k]);
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
      rows.push(prefix ? cells.map((c, k) => join(prefix![k], c)) : cells);
      prefix = null;
      source.push({ page });
    });
  });
  if (!header || rows.length < 1) return null;
  const headers = (header as string[]).map((h, k) => h || `Column ${k + 1}`);
  // A header repeated on every page can still slip through as a row.
  const key = headers.map(norm).join("|");
  const keep = rows.map((r, k) => (r.map(norm).join("|") === key ? -1 : k)).filter((k) => k >= 0);
  const repeated = new Set(rows.map((_, k) => k).filter((k) => !keep.includes(k)));
  // A "column" no row writes in came from header words alone: a label wider than its column ("Precio" over
  // right-aligned prices headed "Precio unitario") joins the nearest column, an empty one is dropped.
  const names = [...headers];
  const blank = headers.map((_, c) => keep.length >= 2 && keep.every((k) => !rows[k][c]));
  blank.forEach((b, c) => {
    if (!b || /^Column \d+$/.test(names[c])) return;
    const gap = (a: number, z: number) => (cols[a] && cols[z] && !blank[a === c ? z : a] ? cols[z][0] - cols[a][1] : Infinity);
    const [left, right] = [gap(c - 1, c), gap(c, c + 1)];
    if (left === Infinity && right === Infinity) return (blank[c] = false);
    const n = left <= right ? c - 1 : c + 1;
    names[n] = n < c ? `${names[n]} ${names[c]}` : `${names[c]} ${names[n]}`.replace(/ Column \d+$/, "");
  });
  if (blank.some(Boolean)) {
    const pick = <T,>(r: T[]) => r.filter((_, c) => !blank[c]);
    return finish(pick(names.map((h, k) => (/^Column \d+$/.test(h) ? `Column ${pick(names).indexOf(h) + 1}` : h))), rows.map(pick), pick(cols));
  }
  return finish(headers, rows, cols);

  function finish(headers: string[], rows: string[][], cols: [number, number][]): Table {
  const total = totalRows(rows, keep);
  const data = keep.filter((k) => !total.has(k));
  const lines = marks.map(({ row, ...m }) => (row === undefined ? m : repeated.has(row) ? { ...m, kind: "header" as const } : total.has(row) ? { ...m, kind: "total" as const } : m));
  return { headers, rows: data.map((k) => rows[k]), source: data.map((k) => source[k]), totals: [...total].map((k) => rows[k]), layout: { columns: cols, lines } };
  }
}

/**
 * Subtotal and total lines. A bare label ("Total", "Grand total", "Toplam:") is one; a longer one
 * ("Subtotal North", but not the product "Total Care Shampoo") only when a figure on it is the sum of
 * the rows above it, since the last subtotal or since the start.
 */
function totalRows(rows: string[][], order: number[]): Set<number> {
  const decimal = decimalOf(rows.flat());
  const out = new Set<number>();
  const cols = rows[0]?.length ?? 0;
  const part = new Array(cols).fill(0), all = new Array(cols).fill(0);
  for (const k of order) {
    const label = rows[k].find(Boolean) ?? "";
    const figures = rows[k].map((c) => toNumber(c, decimal));
    if (TOTAL.test(label) && figures.some((n) => n !== null)) {
      const bare = TOTAL_ONLY.test(label.trim());
      const adds = figures.some((n, c) => n !== null && n !== 0 && (Math.abs(n - part[c]) < 0.005 || Math.abs(n - all[c]) < 0.005));
      if (bare || adds) {
        out.add(k);
        part.fill(0);
        continue;
      }
    }
    figures.forEach((n, c) => n !== null && ((part[c] += n), (all[c] += n)));
  }
  return out;
}

/** A header label: text, a period ("2026"), or empty; "Units 2" and "VAT 20%" are labels, "1,250.00" is not. */
const isLabel = (c: string) => !c || PERIOD.test(c) || (/\p{L}/u.test(c) && !isFigure(c) && !toDate(c));

/** True when two words in one text run, an ordinary space apart, land in different columns. */
function bridges(l: Line, cols: [number, number][], times = 1): boolean {
  const col = (w: Word) => cols.findIndex(([a, b]) => (w.x0 + w.x1) / 2 >= a - 1.5 && (w.x0 + w.x1) / 2 <= b + 1.5);
  return l.words.filter((w, i) => i > 0 && w.glued && col(w) !== col(l.words[i - 1]) && !isFigure(w.text) && !isFigure(l.words[i - 1].text)).length >= times;
}

/** Joins the parts of a wrapped cell; a break after a hyphen ("K-" / "64356", "well-" / "known") adds no space. */
const join = (a: string, b: string) => (!a ? b : !b ? a : /\p{L}-$/u.test(a) ? a + b : `${a} ${b}`);

/** A wrapped cell continues text; a cell under a figure is a new line (a subtotal, a second amount). */
const isFigure = (s: string) => toNumber(s) !== null || toNumber(s, ",") !== null;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A period used as a column label in financial statements: "2026", "FY2025", "Q3 2026", "2025/26", "31.12.2026". */
const PERIOD = /^(?:(?:FY|Q[1-4]|H[12])\s?)?(?:19|20)\d{2}(?:[-/](?:\d{2}|(?:19|20)\d{2}))?$|^\d{1,2}[./]\d{1,2}[./](?:19|20)\d{2}$/i;

/** A label that is nothing but "Total" in one of the covered languages, with an optional colon or currency. */
const TOTAL_ONLY = /^(?:sub-?total|total|totals|grand total|sum|summe|zwischensumme|gesamt\w*|endsumme|toplam|ara toplam|genel toplam|sous-total|total général|totale|subtotale|totaal|subtotaal|razem|suma|合計|小計)\s*(?:\([^)]*\))?:?$/i;

/** First cell of a subtotal or total line, in the languages the samples cover. */
const TOTAL = /^(?:sub-?total|total|totals|grand total|sum|summe|zwischensumme|gesamt\w*|endsumme|toplam|ara toplam|genel toplam|sous-total|total général|totale|subtotale|totaal|subtotaal|razem|suma|合計|小計)\b/i;

/** Columns worth splitting on: a handful of repeated values (e.g. Branch, Store). */
export function splitCandidates(t: Table): { index: number; unique: number }[] {
  return t.headers
    .map((_, index) => ({ index, unique: new Set(t.rows.map((r) => r[index])).size }))
    .filter((c) => c.unique >= 2 && c.unique <= 30 && c.unique < t.rows.length / 2);
}

export type Kind = "number" | "percent" | "date" | "text";

export interface ColumnKind {
  kind: Kind;
  decimal: Decimal;
  order: "dmy" | "mdy";
}

/** Identifiers stay text: leading zeros (000123, ZIP 02134) and long digit runs (card numbers) would be lost as numbers. */
const ID_HEADER = /^(no|#|id|order|index|row)\b|\b(zip|postal|postcode|plz|account|acct|iban|card|phone|tel|ref|reference|code|sku|id|nr|no\.?|number|vkn|tckn)\b/i;

/** What each column holds, and how its numbers and dates are written. */
export function columnKinds(t: Table): ColumnKind[] {
  const all = decimalOf(t.rows.flat());
  return t.headers.map((h, i) => {
    const values = t.rows.map((r) => r[i]).filter(Boolean);
    const own = decimalOf(values);
    // A column of "1.234" alone does not say which mark is the decimal: the rest of the document does.
    const decimal = values.some((v) => /\d[.,]\d{1,2}(?!\d)|\d[.,]\d{3}[.,]\d/.test(v)) ? own : all;
    const settled = dateOrderOf(values);
    const order = settled ?? "dmy";
    const base = { decimal, order };
    if (!values.length) return { kind: "text", ...base };
    if (values.every((v) => toNumber(v, decimal) !== null)) {
      const plain = values.every((v) => /^\d+$/.test(v.trim()));
      const id = plain && (values.some((v) => /^0\d/.test(v.trim()) || v.trim().length >= 12) || ID_HEADER.test(h.trim()));
      const counter = t.rows.length > 1 && t.rows.every((r, k) => toNumber(r[i], decimal) === k + 1);
      if (!id && !counter && !/^(no|#|id|order|index|row)\b/i.test(h.trim())) return { kind: values.every(isPercent) ? "percent" : "number", ...base };
      return { kind: "text", ...base };
    }
    if (settled && values.every((v) => toDate(v, order))) return { kind: "date", ...base };
    return { kind: "text", ...base };
  });
}

/** Numeric columns (amounts, quantities, percentages), excluding identifiers such as "No", "Order" or "000123". */
export function numericColumns(t: Table): number[] {
  return columnKinds(t)
    .map((k, i) => (k.kind === "number" || k.kind === "percent" ? i : -1))
    .filter((i) => i >= 0);
}

/** Per-unit figures (prices, rates, averages) that make no sense summed, in the languages the samples cover. */
export const PER_UNIT = /price|\brate\b|\bunit\b|percent|%|avg|average|preis|stückpreis|tarif|prix|precio|prezzo|prijs|cena|fiyat|birim|oran|ortalama|kurs|単価/i;

/** The number in a cell of a numeric column, read the way that column is written. */
export const numberIn = (k: ColumnKind, s: string) => toNumber(s, k.decimal);
