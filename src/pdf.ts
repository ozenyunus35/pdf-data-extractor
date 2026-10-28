import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageText } from "./table";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function readPdf(data: ArrayBuffer): Promise<PageText[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push({
      page: p,
      items: content.items
        .filter((i): i is Extract<typeof i, { str: string }> => "str" in i)
        .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, height: i.height })),
    });
  }
  await doc.destroy();
  return pages;
}

/** Renders one page into `canvas` at `cssWidth` pixels wide and returns the PDF-to-pixel scale and page height. */
export async function renderPage(data: ArrayBuffer, page: number, canvas: HTMLCanvasElement, cssWidth: number) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
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
