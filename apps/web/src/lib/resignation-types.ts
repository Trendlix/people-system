import type { ResignationLetterState, ResignationRequestStatus } from '@trendlix/shared';

// An employee's resignation request as the API sends it (owner, 26 October 2026; apps/api resignation-requests/views.ts).
// Dates are "YYYY-MM-DD"; moments are ISO. A direct manager gets no reason and no letters (null).

export interface ResignationRequestView {
  id: string;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  employmentId: string;
  status: ResignationRequestStatus;
  statusLabel: string;
  reason: string | null;
  preferredLastDay: string | null;
  /** The notice received day. */
  sentOn: string;
  /** "3 months": the resignation rule's notice when it was sent. */
  notice: string;
  /** The last working day that notice gives from the day it was sent. */
  ruleLastDay: string;
  /**
   * The letter People prepares from the request (owner, 31 October 2026: "on the resignation, the letter is auto
   * generated, viewed by the employee but uploaded by the HR"): ready to view, or not until HR publishes its template.
   */
  preparedLetter: ResignationLetterState | null;
  /** The signed copy HR uploaded (or the employee attached before 31 October 2026). */
  letter: { letterFileName: string; mimeType: string; sizeBytes: number } | null;
  withdrawnAt: string | null;
  returned: { reason: string | null; at: string | null; by: { email: string } | null } | null;
  recorded: { at: string | null; by: { email: string } | null; endingId: string | null; endingStatus: string | null } | null;
  createdAt: string;
  mine: boolean;
  /** A C-level person's: the CEO's, not HR's. */
  confidential: boolean;
  /** On one request only: whether the caller records or returns it. */
  canRecord?: boolean;
  /** On one request only: whether the caller uploads its signed letter (HR; the CEO for a C-level person). */
  canUploadLetter?: boolean;
}

/** GET /me/resignation. */
export interface MyResignation {
  requests: ResignationRequestView[];
  form: {
    offered: boolean;
    refusal: string | null;
    today: string;
    notice: string | null;
    noticeAmount: number | null;
    noticeUnit: string | null;
    /** The last working day the rule's notice gives if it is sent today. */
    lastDayIfToday: string | null;
  };
}
