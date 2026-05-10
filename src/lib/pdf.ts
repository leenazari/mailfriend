// PDF text extraction. We use pdf-parse (no native deps).
// Errors are swallowed and returned as empty strings — a malformed
// or encrypted PDF should not break a sync run.

// Lazy-require so it's only loaded on the server when needed.
// pdf-parse has a quirky default export.
type PdfParseFn = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

let cached: PdfParseFn | null = null;
async function loadPdfParse(): Promise<PdfParseFn> {
  if (cached) return cached;
  const mod = await import('pdf-parse');
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
