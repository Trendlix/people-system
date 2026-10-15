// A filled document (a generated document, a job offer, a template previewed with data) leaves the system only as a
// protected PDF (owner's request, 15 October 2026: "No doc file export, just a protected PDF"): the API encrypts it
// (AES-256: it opens without a password and prints, but can't be edited or copied from), and the route handlers that
// serve one under the web domain pass on nothing else, opened in the browser or (?download=1) saved. The Word templates
// HR uploads and the Fields Guide stay Word files (templates/file-response.ts). No "@/" imports: it is unit tested.

const PDF = 'application/pdf';

/** Said once on a screen where filled documents are opened. */
export const PROTECTED_PDF_HINT = "Documents are protected PDFs: they open and print, but can't be edited.";

/** Whether the browser asked to save the PDF (?download=1, or true, as the API reads it) rather than open it. */
export function wantsDownload(params: URLSearchParams): boolean {
  const download = params.get('download');
  return download === '1' || download === 'true';
}

/** The name a document kept as "<name>.docx" is given out under, as the API names it: "<name>.pdf". */
export const pdfFileName = (name: string) => `${name.trim().replace(/\.(docx|pdf)$/i, '')}.pdf`;

/**
 * The API's protected PDF passed on to the browser: opened in it, or saved when `download`, under the name the API sends
 * (`fallbackName` when it sends none). `headers` are added (e.g. noindex on the candidate's page). Null when the API
 * sent anything but a PDF: the caller answers 502 in its own words.
 */
export function passPdfOn(res: Response, { download, fallbackName, headers }: { download: boolean; fallbackName: string; headers?: Record<string, string> }): Response | null {
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== PDF) return null;

  const disposition = res.headers.get('content-disposition') ?? `attachment; filename="${fallbackName}"`;
  const out = new Headers({
    ...headers,
    'content-type': PDF,
    'content-disposition': download ? disposition.replace(/^\s*inline/i, 'attachment') : disposition.replace(/^\s*attachment/i, 'inline'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    // no content-security-policy: the browser's PDF viewer doesn't open under default-src 'none'
  });
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) out.set('content-length', length);
  return new Response(res.body, { headers: out });
}
