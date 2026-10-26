import { noticeSentence, RESIGNATION_REQUEST_STATUS_LABELS, type ResignationRequestStatus } from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';

export const RESIGNATION_ENTITY = 'resignation_request';
export const LETTER_ENTITY = 'resignation_letter';

/** What a request is read with: its person, who recorded or returned it, and the ending made from it. The letter's bytes are never in a list. */
export const REQUEST_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  employment: { select: { managerId: true, endDate: true } },
  recordedBy: { select: { email: true } },
  returnedBy: { select: { email: true } },
  ending: { select: { id: true, status: true, lastWorkingDay: true } },
} satisfies Prisma.ResignationRequestInclude;

export const REQUEST_OMIT = { letterData: true } satisfies Prisma.ResignationRequestOmit;

export type RequestRow = Prisma.ResignationRequestGetPayload<{ include: typeof REQUEST_INCLUDE; omit: typeof REQUEST_OMIT }>;

/**
 * How the caller stands to a request: `self` (their own: all of it), `full` (HR, the CEO and a Super Admin: all of it),
 * `manager` (the direct manager: that it was sent, its dates and where it stands, but not the reason nor the letter).
 */
export type Viewer = 'self' | 'full' | 'manager';

/**
 * A resignation request as `viewer` may see it. `confidential`: a C-level person's (their request is the CEO's, not HR's).
 * The reason, HR's return reason and the letter are personal: the reason is free text for the developer masking.
 */
export function requestView(r: RequestRow, viewer: Viewer, confidential: boolean) {
  const sees = viewer !== 'manager';
  return {
    id: r.id,
    employee: r.employee,
    employmentId: r.employmentId,
    status: r.status as ResignationRequestStatus,
    statusLabel: RESIGNATION_REQUEST_STATUS_LABELS[r.status as ResignationRequestStatus] ?? r.status,
    reason: sees ? r.reason : null,
    preferredLastDay: fromDateOnly(r.preferredLastDay),
    // the notice received day, and the last working day the resignation rule's notice gives from it
    sentOn: fromDateOnly(r.sentOn),
    notice: noticeSentence(r.noticeAmount, r.noticeUnit),
    ruleLastDay: fromDateOnly(r.ruleLastDay),
    letter: sees && r.letterName ? { letterFileName: r.letterName, mimeType: r.letterMime!, sizeBytes: r.letterSize! } : null,
    withdrawnAt: r.withdrawnAt,
    returned: r.status === 'returned' ? { reason: sees ? r.returnedReason : null, at: r.returnedAt, by: r.returnedBy && { email: r.returnedBy.email } } : null,
    recorded: r.status === 'recorded' ? { at: r.recordedAt, by: r.recordedBy && { email: r.recordedBy.email }, endingId: r.endingId, endingStatus: r.ending?.status ?? null } : null,
    createdAt: r.createdAt,
    mine: viewer === 'self',
    confidential,
  };
}

export type ResignationRequestView = ReturnType<typeof requestView>;
