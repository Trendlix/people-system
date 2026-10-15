import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passPdfOn } from '@/lib/protected-pdf';

// Serves a generated document as an UNPROTECTED PDF, saved, for HR to upload to an e-signature service (Adobe Sign,
// DocuSign), which refuses the protected PDF everyone else gets (owner, 15 October 2026). The API checks the role (HR
// only) and records every download. Without the server's PDF converter the API's reason is shown as plain text. Links
// here are plain links, never prefetched.

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

export async function GET(_req: Request, ctx: RouteContext<'/employees/[id]/documents/[documentId]/esign'>) {
  const { documentId } = await ctx.params;
  if (!ID.test(documentId)) return text('Not found.', 404);

  let res: Response;
  try {
    res = await apiFetch(`/documents/${encodeURIComponent(documentId)}/esign-file`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR can download a document for e-signature.', 403);
  if (res.status === 404) return text('Not found.', 404);
  // no PDF converter on the server (409), or it failed (503): the API says so; there is no Word file instead
  if (res.status === 409 || res.status === 503) return text(await messageOf(res), res.status);
  if (!res.ok) return text('This file could not be loaded. Please try again.', 502);
  return passPdfOn(res, { download: true, fallbackName: 'document (for e-signature).pdf' }) ?? text('This file could not be loaded. Please try again.', 502);
}
