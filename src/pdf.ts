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
