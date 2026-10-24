import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';

// A general CV as a PDF for the CV window (owner, 24 October 2026: "when opening a CV, open it in a popup window"),
// from the API under the web domain, with the caller's session: a PDF as it was sent, a Word file converted by the
// server's PDF service (kept, so it is converted once). The API checks who may see it (HR, the CEO and a Super Admin;
// never a developer). A refusal comes back as a short text, which the window shows (e.g. no PDF service on the server:
// "download it instead").

const ID = /^[0-9a-f-]{36}$/i;

const text = (body: string, status: number) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return text('Not found.', 404);
  let res: Response;
  try {
    res = await apiFetch(`/recruitment/general-cvs/${encodeURIComponent(id)}/cv/preview`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return text('Not found.', 404);
  if (!res.ok || !res.body) return text(res.ok ? 'This CV could not be loaded. Please try again.' : (await messagesOf(res)).join(' '), res.ok ? 502 : res.status);
  const headers = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
  for (const name of ['content-type', 'content-length', 'content-disposition']) {
    const v = res.headers.get(name);
    if (v) headers.set(name, v);
  }
  return new Response(res.body, { status: 200, headers });
}
