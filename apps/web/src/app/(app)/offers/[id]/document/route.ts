import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

// Serves an offer's document from the API under the web domain, with the caller's session: the browser never talks to
// the API. ?format=pdf (the default) is shown in the page (Preview PDF); ?format=docx is downloaded (Download Word). A
// draft's is filled in afresh each time; a sent one's is as sent. The API checks the role (HR, CEO). When the document
// can't be made (values missing, no published template, no PDF converter), the reason is shown as plain text in its
// place. Links here are plain links, never prefetched.

const ID = /^[0-9a-f-]{36}$/i;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF = 'application/pdf';

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

/** The API's refusal in words: its message, and for missing values, which ones. */
async function refusal(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[]; missing?: { label?: string; tag?: string }[] };
    const message = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? '');
    const missing = (body.missing ?? []).map((m) => m.label || m.tag).filter(Boolean);
    return [message || 'The offer document could not be made.', missing.length ? `Missing: ${missing.join(', ')}.` : ''].filter(Boolean).join('\n\n');
  } catch {
    return 'The offer document could not be made.';
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return text('Not found.', 404);
  const format = req.nextUrl.searchParams.get('format') === 'docx' ? 'docx' : 'pdf';

  let res: Response;
  try {
    res = await apiFetch(`/offers/${encodeURIComponent(id)}/document?format=${format}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR and the CEO can see job offers.', 403);
  if (res.status === 404) return text('Not found.', 404);
  if (res.status === 409 || res.status === 422) return text(await refusal(res), res.status);
  if (!res.ok) return text('This file could not be loaded. Please try again.', 502);

  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const allowed = format === 'pdf' ? type === PDF : type === DOCX || type === 'application/octet-stream';
  if (!allowed) return text('This file could not be loaded. Please try again.', 502);

  const fallbackName = format === 'pdf' ? 'job-offer.pdf' : 'job-offer.docx';
  const disposition = res.headers.get('content-disposition') ?? `attachment; filename="${fallbackName}"`;
  const headers = new Headers({
    'content-type': type,
    // the PDF opens in the page; the Word file is saved
    'content-disposition': format === 'pdf' ? disposition.replace(/^\s*attachment/i, 'inline') : disposition.replace(/^\s*inline/i, 'attachment'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    ...(format === 'docx' && { 'content-security-policy': "default-src 'none'" }),
  });
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}
