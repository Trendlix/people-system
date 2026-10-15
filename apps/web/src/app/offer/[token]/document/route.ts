import type { NextRequest } from 'next/server';
import { ApiError, messagesOf } from '@/lib/api';
import { passPdfOn, wantsDownload } from '@/lib/protected-pdf';
import { publicFetch } from '@/lib/public-api';
import { isOfferToken } from '../candidate';

// Serves the offer's document to the candidate, from the API's public address, under the web domain: no sign-in, the
// link's token is the key. It is only ever a protected PDF (owner's request, 15 October 2026: "No doc file export, just
// a protected PDF"): shown in the candidate's page, or saved with ?download=1. When the API can't give it (no PDF
// converter, or the converter failing), its reason is shown as plain text. Never cached, never indexed.

const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
  });

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isOfferToken(token)) return text("This link isn't valid.", 404);
  const download = wantsDownload(req.nextUrl.searchParams);

  let res: Response;
  try {
    res = await publicFetch(`/offers/${encodeURIComponent(token)}/document${download ? '?download=1' : ''}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 404) return text("This link isn't valid, or the offer's document isn't available.", 404);
  if (!res.ok) {
    // 409 (no PDF converter) and 503 (the converter failed) say why; any other server failure is a failure to load
    const told = res.status < 500 || res.status === 503;
    const said = told ? (await messagesOf(res)).filter((m) => !/^Request failed \(/.test(m)) : [];
    return text(said.join(' ') || 'The offer could not be loaded. Please try again in a moment.', told ? res.status : 502);
  }

  const passed = passPdfOn(res, {
    download,
    fallbackName: 'job-offer.pdf',
    headers: { 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' },
  });
  return passed ?? text('The offer could not be loaded. Please try again in a moment.', 502);
}
