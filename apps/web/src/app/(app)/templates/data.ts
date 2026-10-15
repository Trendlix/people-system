import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { TemplateDetail, TemplateSlotView, TemplateVersionLines } from '@/lib/types';

// Reading the template library (GET /templates, GET /templates/:slot; October 2026). An API from before it answers 404,
// which here means "not available yet" rather than the 404 page (the template pages check the slot's key against
// TEMPLATE_SLOTS first); a refusal (403) and any other failure are shown quietly in the page's place.

export type Loaded<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'unavailable' }
  | { kind: 'forbidden'; message: string }
  | { kind: 'failed'; message: string };

async function load<T>(path: string): Promise<Loaded<T>> {
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', message: err.message };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 403) return { kind: 'forbidden', message: (await messagesOf(res)).join(' ') };
  if (!res.ok) return { kind: 'failed', message: (await messagesOf(res)).join(' ') };
  try {
    return { kind: 'ok', data: (await res.json()) as T };
  } catch {
    return { kind: 'failed', message: 'The server sent an answer that could not be read.' };
  }
}

/** Every slot of the library, with its version in use and its newest draft. */
export function loadLibrary(): Promise<Loaded<TemplateSlotView[]>> {
  return load<TemplateSlotView[]>('/templates');
}

/** One slot and all the versions of its file, newest first. */
export function loadTemplate(key: string): Promise<Loaded<TemplateDetail>> {
  return load<TemplateDetail>(`/templates/${encodeURIComponent(key)}`);
}

/** A version's lines, with their tags, blanks and suggested fields, for Map Fields (HR and Admin). */
export function loadVersionLines(versionId: string): Promise<Loaded<TemplateVersionLines>> {
  return load<TemplateVersionLines>(`/templates/versions/${encodeURIComponent(versionId)}/lines`);
}
