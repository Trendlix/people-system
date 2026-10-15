import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { DocumentsTab } from '@/lib/types';

// Loading the documents generated from templates for the profile's Contracts tab. They came with document generation
// (October 2026): an API from before it answers 404, which here means "not available yet" rather than the 404 page, so
// the moved contract section and the rest of the profile keep working.

export type DocumentsLoad =
  | { kind: 'ok'; tab: DocumentsTab }
  /** The server doesn't have document generation yet. */
  | { kind: 'unavailable' }
  /** Not the caller's to see (HR and the CEO only). */
  | { kind: 'forbidden' }
  | { kind: 'failed'; messages: string[] };

/** GET /employees/:id/documents. Signs out on 401. */
export async function loadDocuments(employeeId: string): Promise<DocumentsLoad> {
  let res: Response;
  try {
    res = await apiFetch(`/employees/${employeeId}/documents`);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  const tab = (await res.json()) as Partial<DocumentsTab> | null;
  return { kind: 'ok', tab: { sections: Array.isArray(tab?.sections) ? tab.sections : [] } };
}
