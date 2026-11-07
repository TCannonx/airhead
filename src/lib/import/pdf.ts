/**
 * Text from a PDF on the device (Task 4.10). A text PDF's words are read here
 * and then structured by one small AI call; a scanned PDF (little or no text)
 * goes to the AI as a document instead.
 */
export const MIN_TEXT_CHARS = 40;

export async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      } else {
        line += ' ';
      }
    }
    if (line.trim()) lines.push(line);
    pages.push(
      lines
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n'),
    );
  }
  await task.destroy();
  return pages.join('\n\n').trim();
}

/** A PDF with almost no text is a scan or a picture. */
export const looksScanned = (text: string) => text.replace(/\s/g, '').length < MIN_TEXT_CHARS;
