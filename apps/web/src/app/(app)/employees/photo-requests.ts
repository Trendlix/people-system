import { formatDate, formatDateTime } from '../../../lib/format';
import type { PhotoRequest } from '../../../lib/types';

// A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"): the words and addresses the employee's Photo page, the confirm page, Approvals and Details
// Changes share. HR or an Admin (a C-level person's: the CEO or a Super Admin) approves it, and it becomes the employee
// file's personal photo, or rejects it with a note or none; the employee may cancel it while it waits. Pure, so it is
// unit tested (photo-requests.test.ts); relative imports, as vitest doesn't know the @/ paths.

/** The photos the API takes, by content: listing the types (not image/*) makes an iPhone hand over a JPEG, not a HEIC. */
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

/** The API takes a photo of up to 10 MB, as a paper of the employee file; checked here too, before a long upload. */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_TOO_LARGE = 'The photo must be 10 MB or smaller.';

/** The employee's Photo page. */
export const ownPhotoHref = (employeeId: string) => `/employees/${employeeId}/photo`;

/** Where a sent photo is loaded from (app/photo-request), under the web domain with the session. */
export const sentPhotoSrc = (requestId: string) => `/photo-request/${requestId}`;

/** The photo waiting for HR, if any (the API allows one at a time). */
export function pendingPhoto(requests: readonly PhotoRequest[] | undefined): PhotoRequest | undefined {
  return requests?.find((r) => r.status === 'pending');
}

/**
 * A closed request as the employee sees it: what happened and when ("Approved on 31/10/2026: now your picture") and HR's
 * note, if any; null while it waits.
 */
export function photoOutcome(r: Pick<PhotoRequest, 'status' | 'requestedAt' | 'decidedAt' | 'decisionNote'>): { title: string; note: string | null } | null {
  if (r.status === 'pending') return null;
  const sent = `Sent ${formatDate(r.requestedAt)}`;
  const on = r.decidedAt ? ` on ${formatDate(r.decidedAt)}` : '';
  const note = r.decisionNote?.trim() || null;
  if (r.status === 'approved') return { title: `${sent} · approved${on}: now your picture`, note };
  if (r.status === 'rejected') return { title: `${sent} · rejected${on}: your photo stayed as it was`, note };
  return { title: `${sent} · cancelled${on}`, note: null };
}

/** A decided request on HR's lists: who decided and when, and the note; cancelled, by the employee. Null while it waits. */
export function photoDecisionView(r: Pick<PhotoRequest, 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote'>): { title: string; at: string | null; note: string | null } | null {
  if (r.status === 'pending') return null;
  const at = r.decidedAt ? formatDateTime(r.decidedAt) : null;
  const note = r.decisionNote?.trim() || null;
  if (r.status === 'cancelled') return { title: 'Cancelled by the employee', at, note: null };
  const by = r.decidedBy?.email ? ` by ${r.decidedBy.email}` : '';
  return { title: `${r.status === 'approved' ? 'Approved' : 'Rejected'}${by}`, at, note };
}

/** The API's list for a status: GET /photo-requests?status=…, `all` for every one. */
export const photoRequestsPath = (status: string) => `/photo-requests?status=${status || 'all'}`;

/** "1 photo", "3 photos". */
export const photosLabel = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`;
