import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passPdfOn, wantsDownload } from '@/lib/protected-pdf';

// Serves a generated document from the API under the web domain, with the caller's session: the browser never talks to
// the API. The API checks the role (HR, CEO). It is only ever a protected PDF (owner's request, 15 October 2026: "No doc
// file export, just a protected PDF"): opened in the browser (the Employment tab's Preview (PDF)), or saved with
// ?download=1 (Download PDF). Without the server's PDF converter there is no document to give out, and the API's reason
// is shown as plain text. Links here are plain links, never prefetched.

const ID = /^[0-9a-z-]{1,64}$/i;

/** The API's reason, as text. */
async function messageOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    return (Array.isArray(body.message) ? body.message.join(' ') : body.message) || 'There is no preview of this file.';
  } catch {
    return 'There is no preview of this file.';
  }
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

export async function GET(req: Request, ctx: RouteContext<'/employees/[id]/documents/[documentId]/file'>) {
  const { documentId } = await ctx.params;
  if (!ID.test(documentId)) return text('Not found.', 404);
  const download = wantsDownload(new URL(req.url).searchParams);

  let res: Response;
  try {
    res = await apiFetch(`/documents/${encodeURIComponent(documentId)}/file${download ? '?download=1' : ''}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR and the CEO can download generated documents.', 403);
  if (res.status === 404) return text('Not found.', 404);
  // no PDF converter on the server (409), or it failed (503): the API says so; there is no Word file instead
  if (res.status === 409 || res.status === 503) return text(await messageOf(res), res.status);
  if (!res.ok) return text('This file could not be loaded. Please try again.', 502);
  return passPdfOn(res, { download, fallbackName: 'document.pdf' }) ?? text('This file could not be loaded. Please try again.', 502);
}
