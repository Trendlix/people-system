import type { ChangeRequestStatus } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';

// A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"), as the API sends it: never the file itself, which has its own address
// (GET /photo-requests/:id/photo). Used by the photo requests module and by the employee profile, which lists the
// employee's own.

/** What a photo request is read with: its facts (never the file), whose it is, who asked and who decided. */
export const PHOTO_REQUEST_SELECT = {
  id: true,
  employeeId: true,
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  note: true,
  status: true,
  requestedById: true,
  requestedBy: { select: { email: true } },
  requestedAt: true,
  decidedBy: { select: { email: true } },
  decidedAt: true,
  decisionNote: true,
  photoId: true,
} satisfies Prisma.ProfilePhotoRequestSelect;

export type PhotoRequestRow = Prisma.ProfilePhotoRequestGetPayload<{ select: typeof PHOTO_REQUEST_SELECT }>;

/**
 * A photo request: whose profile it is, the file's name, type and size, the employee's note, where it stands, who asked
 * and who decided (or the employee who cancelled it), HR's note, and, once approved, the personal photo it became.
 */
export function photoRequestView(r: PhotoRequestRow) {
  return {
    id: r.id,
    employee: r.employee,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    note: r.note,
    status: r.status as ChangeRequestStatus,
    requestedBy: { email: r.requestedBy.email },
    requestedAt: r.requestedAt,
    decidedBy: r.decidedBy && { email: r.decidedBy.email },
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    photoId: r.photoId,
  };
}

export type PhotoRequestView = ReturnType<typeof photoRequestView>;
