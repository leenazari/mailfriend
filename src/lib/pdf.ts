// PDF text extraction.
//
// IMPORTANT: We import `pdf-parse/lib/pdf-parse.js` directly rather than
// the package root. The root index.js runs a self-test that tries to read
// a sample PDF from a path that doesn't exist on Vercel — that fails
// silently and breaks all extraction. Hitting the inner module avoids it.

type PdfParseFn = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

let cached: PdfParseFn | null = null;
async function loadPdfParse(): Promise<PdfParseFn> {
  if (cached) return cached;
  // @ts-expect-error - no types for the inner path; behaves identically.
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  cached = (mod.default ?? mod) as PdfParseFn;
  return cached;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = await loadPdfParse();
    const result = await pdfParse(buffer);
    return (result.text ?? '').trim();
  } catch (err) {
    console.warn('[pdf] extraction failed:', (err as Error).message);
    return '';
  }
}
