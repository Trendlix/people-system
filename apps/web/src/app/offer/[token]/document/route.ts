import type { NextRequest } from 'next/server';
import { ApiError, messagesOf } from '@/lib/api';
import { publicFetch } from '@/lib/public-api';
import { isOfferToken } from '../candidate';

// Serves the offer's document to the candidate, from the API's public address, under the web domain: no sign-in, the
// link's token is the key. The PDF is shown in the candidate's page (?download=1 saves it); a Word file is always saved.
// Never cached, never indexed.

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF = 'application/pdf';

const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
  });

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isOfferToken(token)) return text("This link isn't valid.", 404);
  const download = req.nextUrl.searchParams.has('download');

  let res: Response;
  try {
    res = await publicFetch(`/offers/${encodeURIComponent(token)}/document`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 404) return text("This link isn't valid, or the offer's document isn't available.", 404);
  if (!res.ok) {
    const messages = res.status < 500 ? await messagesOf(res) : [];
    return text(messages.join(' ') || 'The offer could not be loaded. Please try again in a moment.', res.status < 500 ? res.status : 502);
  }

  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== PDF && type !== DOCX && type !== 'application/octet-stream') return text('The offer could not be loaded. Please try again in a moment.', 502);

  const inline = type === PDF && !download;
  const fallbackName = type === PDF ? 'job-offer.pdf' : 'job-offer.docx';
  const disposition = res.headers.get('content-disposition') ?? `attachment; filename="${fallbackName}"`;
  const headers = new Headers({
    'content-type': type,
    'content-disposition': inline ? disposition.replace(/^\s*attachment/i, 'inline') : disposition.replace(/^\s*inline/i, 'attachment'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex',
    'referrer-policy': 'no-referrer',
    ...(type !== PDF && { 'content-security-policy': "default-src 'none'" }),
  });
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}
