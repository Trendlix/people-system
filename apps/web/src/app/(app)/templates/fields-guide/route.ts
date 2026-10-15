import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { apiReason, passFileOn, textResponse as text } from '../file-response';

// Serves the Fields Guide (owner's request, 15 October 2026: every tag and template, made by the API from the shared
// lists) under the web domain, with the caller's session, as a version's file is served: the Word file is downloaded;
// ?format=pdf is the same guide as a PDF, shown in the browser. Anyone signed in may have it, as the tag list. Links
// here are plain links, never prefetched.

export async function GET(req: Request) {
  const pdf = new URL(req.url).searchParams.get('format') === 'pdf';

  let res: Response;
  try {
    res = await apiFetch(`/templates/fields-guide${pdf ? '?format=pdf' : ''}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  // a server from before the guide
  if (res.status === 404) return text('Not available yet: the server does not have the Fields Guide yet. Please try again after its next update.', 404);
  // no PDF converter on the server: the API says so, and the Word file can still be downloaded
  if (res.status === 409 || res.status === 503) return text(await apiReason(res, 'There is no PDF of the Fields Guide.'), res.status);
  if (!res.ok) return text('The Fields Guide could not be loaded. Please try again.', 502);
  return passFileOn(res, pdf, 'Template Fields Guide');
}
