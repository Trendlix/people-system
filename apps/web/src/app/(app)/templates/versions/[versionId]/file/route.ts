import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';

// Serves one version of a template's Word file from the API under the web domain, with the caller's session: the
// browser never talks to the API. The API checks the role (HR, Admin, CEO). The Word file is always downloaded;
// ?format=pdf is the same file as a PDF, shown in the browser (Preview, owner's request, 15 October 2026). Links here
// are plain links, never prefetched.

const ID = /^[0-9a-z-]{1,64}$/i;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FILE_TYPES = new Set([DOCX, 'application/octet-stream']);
const PDF = 'application/pdf';

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

export async function GET(req: Request, ctx: RouteContext<'/templates/versions/[versionId]/file'>) {
  const { versionId } = await ctx.params;
  if (!ID.test(versionId)) return text('Not found.', 404);
  const pdf = new URL(req.url).searchParams.get('format') === 'pdf';

  let res: Response;
  try {
    res = await apiFetch(`/templates/versions/${encodeURIComponent(versionId)}/file${pdf ? '?format=pdf' : ''}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, Admin and the CEO can download templates.', 403);
  if (res.status === 404) return text('Not found.', 404);
  // no PDF converter on the server: the API says so, and the Word file can still be downloaded
  if (res.status === 409 || res.status === 503) return text(await messageOf(res), res.status);
  if (!res.ok) return text('This file could not be loaded. Please try again.', 502);

  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (pdf ? type !== PDF : !FILE_TYPES.has(type)) return text('This file could not be loaded. Please try again.', 502);

  const disposition = res.headers.get('content-disposition') ?? `attachment; filename="template.${pdf ? 'pdf' : 'docx'}"`;
  const headers = new Headers({
    'content-type': type,
    // the PDF opens in the browser; the Word file is saved. The API sends the file's name
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
