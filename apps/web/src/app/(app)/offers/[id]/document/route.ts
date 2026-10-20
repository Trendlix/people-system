import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';
import { passPdfOn, wantsDownload } from '@/lib/protected-pdf';

// Serves an offer's document from the API under the web domain, with the caller's session: the browser never talks to
// the API. It is only ever a protected PDF (owner's request, 15 October 2026: "No doc file export, just a protected
// PDF"): opened in the page (Preview (PDF)), or saved with ?download=1 (Download PDF). A draft's is filled in afresh each
// time (from the newest draft of its template while none is published, which the API's X-Template-Draft header names,
// passed on); a sent one's is as sent. The API checks the role (HR, CEO). When the document can't be made (values
// missing, no template, no PDF converter, the converter failing), the reason is shown as plain text in its place.
// Links here are plain links, never prefetched. Print loads it into the page to print it (owner's request, 20 October
// 2026: "add Print Button"), showing that reason under the button.

const ID = /^[0-9a-f-]{36}$/i;

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
  const download = wantsDownload(req.nextUrl.searchParams);

  let res: Response;
  try {
    res = await apiFetch(`/offers/${encodeURIComponent(id)}/document${download ? '?download=1' : ''}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR and the CEO can see job offers.', 403);
  if (res.status === 404) return text('Not found.', 404);
  if (res.status === 409 || res.status === 422 || res.status === 503) return text(await refusal(res), res.status);
  if (!res.ok) return text('This file could not be loaded. Please try again.', 502);

  const draft = res.headers.get('x-template-draft');
  const passed = passPdfOn(res, { download, fallbackName: 'job-offer.pdf', headers: draft && /^\d{1,6}$/.test(draft) ? { 'x-template-draft': draft } : {} });
  return passed ?? text('This file could not be loaded. Please try again.', 502);
}
