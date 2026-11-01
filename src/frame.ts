// Puts the text of a page into reading position. A landscape table can sit on a page
// turned with /Rotate, or be drawn with turned text on a portrait page; either way the
// table reads left to right once the page is turned by the text's own direction.

import type { PageText } from "./table.ts";

/** pdf.js text item and viewport, as far as this module needs them. */
export interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
export interface RawViewport {
  transform: number[];
  width: number;
  height: number;
}

export type Turn = 0 | 90 | 180 | 270;

/** How a page was turned to read it, and its size as displayed. */
export interface Frame {
  turn: Turn;
  width: number;
  height: number;
}

const multiply = (a: number[], b: number[]) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

/** Direction text runs in on the displayed page (y down): 0 is left to right, 90 top to bottom. */
const turnOf = (m: number[]): Turn => (((Math.round(Math.atan2(m[1], m[0]) / (Math.PI / 2)) + 4) % 4) * 90) as Turn;

/**
 * The page's text in reading coordinates (y up, as PDF units), turned so the text
 * most of the page is written in runs left to right. Text at other angles (a stamp,
 * a vertical margin note) is left out.
 */
export function pageText(page: number, items: RawItem[], vp: RawViewport): PageText & { frame: Frame } {
  const placed = items.filter((i) => i.str.trim()).map((i) => ({ i, m: multiply(vp.transform, i.transform) }));
  const weight = new Map<Turn, number>();
  for (const { i, m } of placed) weight.set(turnOf(m), (weight.get(turnOf(m)) ?? 0) + i.str.length);
  const turn = ([...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0) as Turn;
  const [W, H] = turn % 180 ? [vp.height, vp.width] : [vp.width, vp.height];
  const read = (x: number, y: number): [number, number] =>
    turn === 0 ? [x, y] : turn === 90 ? [y, vp.width - x] : turn === 180 ? [vp.width - x, vp.height - y] : [vp.height - y, x];
  return {
    page,
    frame: { turn, width: vp.width, height: vp.height },
    items: placed
      .filter(({ m }) => turnOf(m) === turn)
      .map(({ i, m }) => {
        const [x, down] = read(m[4], m[5]);
        return { str: i.str, x, y: H - down, width: i.width, height: i.height };
      })
      .filter((it) => it.x > -W && it.x < 2 * W),
  };
}

/** SVG matrix that maps reading coordinates (y down) back onto the displayed page. */
export function displayMatrix(f: Frame): [number, number, number, number, number, number] {
  if (f.turn === 90) return [0, 1, -1, 0, f.width, 0];
  if (f.turn === 180) return [-1, 0, 0, -1, f.width, f.height];
  if (f.turn === 270) return [0, -1, 1, 0, 0, f.height];
  return [1, 0, 0, 1, 0, 0];
}

/** Height of the page in reading position. */
export const readingHeight = (f: Frame) => (f.turn % 180 ? f.width : f.height);
