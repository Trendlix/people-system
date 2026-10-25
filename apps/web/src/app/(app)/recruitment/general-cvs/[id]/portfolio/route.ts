import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';

// A general CV's PDF case study (owner, 25 October 2026: "for creatives, they need to add their portfolios"; asked,
// "Portfolio per position"), sent on "Send us your CV" when its position takes one, from the API under the web domain
// with the caller's session, as the CV is: the browser never talks to the API. It opens in the browser (or is saved with
// ?download=1). The API checks who may see it (HR, the CEO and a Super Admin), and never a developer.

const ID = /^[0-9a-f-]{36}$/i;

const text = (body: string, status: number) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return text('Not found.', 404);
  const download = req.nextUrl.searchParams.get('download') === '1';
  let res: Response;
  try {
    res = await apiFetch(`/recruitment/general-cvs/${encodeURIComponent(id)}/portfolio-file${download ? '?download=1' : ''}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return text('Not found.', 404);
  if (!res.ok || !res.body) return text(res.ok ? 'This file could not be loaded. Please try again.' : (await messagesOf(res)).join(' '), res.ok ? 502 : res.status);
  const headers = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
  for (const name of ['content-type', 'content-length', 'content-disposition']) {
    const v = res.headers.get(name);
    if (v) headers.set(name, v);
  }
  return new Response(res.body, { status: 200, headers });
}
