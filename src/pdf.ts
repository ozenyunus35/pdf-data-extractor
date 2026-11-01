import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pageText, type Frame, type RawItem } from "./frame";
import type { PageText } from "./table";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Why a file could not be opened, in words for the file list. */
export type OpenError = "password" | "wrong password" | "empty file" | "not a PDF or damaged";

export class PdfError extends Error {
  constructor(readonly reason: OpenError) {
    super(reason);
  }
}

async function open(data: ArrayBuffer, password?: string) {
  if (!data.byteLength) throw new PdfError("empty file");
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), password }).promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err.name === "PasswordException") throw new PdfError(err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? "wrong password" : "password");
    throw new PdfError("not a PDF or damaged");
  }
}

export async function readPdf(data: ArrayBuffer, password?: string): Promise<(PageText & { frame: Frame })[]> {
  const doc = await open(data, password);
  const pages: (PageText & { frame: Frame })[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(pageText(p, content.items.filter((i): i is Extract<typeof i, { str: string }> => "str" in i) as RawItem[], page.getViewport({ scale: 1 })));
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

/** Renders one page into `canvas` at `cssWidth` pixels wide and returns the PDF-to-pixel scale and page height. */
export async function renderPage(data: ArrayBuffer, page: number, canvas: HTMLCanvasElement, cssWidth: number, password?: string) {
  const doc = await open(data, password);
  try {
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const scale = cssWidth / base.width;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = p.getViewport({ scale: scale * dpr });
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${base.height * scale}px`;
    await p.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    return { scale, height: base.height, width: base.width, pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
