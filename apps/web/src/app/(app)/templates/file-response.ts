// Passing a Word file from the API on to the browser, for the route handlers that serve one under the web domain with
// the caller's session (a template version's file, the Fields Guide): the Word file is downloaded; as a PDF it opens
// in the browser. These are HR's own and the system's own files, so they stay Word files; a filled document is given
// only as a protected PDF (owner's request, 15 October 2026; lib/protected-pdf.ts).

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FILE_TYPES = new Set([DOCX, 'application/octet-stream']);
const PDF = 'application/pdf';

/** A short answer in plain text, never stored. */
export const textResponse = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

/** The API's reason, as text; `fallback` when it gives none. */
export async function apiReason(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    return (Array.isArray(body.message) ? body.message.join(' ') : body.message) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * The API's file passed on: the Word file as an attachment, the PDF inline, each with the name the API sends
 * (`fallbackName`, without its extension, when it sends none). A 502 when the API sent something else.
 */
export function passFileOn(res: Response, pdf: boolean, fallbackName: string): Response {
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (pdf ? type !== PDF : !FILE_TYPES.has(type)) return textResponse('This file could not be loaded. Please try again.', 502);

  const disposition = res.headers.get('content-disposition') ?? `attachment; filename="${fallbackName}.${pdf ? 'pdf' : 'docx'}"`;
  const headers = new Headers({
    'content-type': type,
    // the PDF opens in the browser; the Word file is saved
    'content-disposition': pdf ? disposition.replace(/^\s*attachment/i, 'inline') : disposition.replace(/^\s*inline/i, 'attachment'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    // the browser's PDF viewer doesn't open under default-src 'none'
    ...(!pdf && { 'content-security-policy': "default-src 'none'" }),
  });
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}
