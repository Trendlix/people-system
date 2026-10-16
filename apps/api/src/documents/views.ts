import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';

// What the Employment tab and the lifecycle endpoints send for a generated document: never the files themselves, which
// have their own endpoints.

/** A document's lifecycle: generated (the filled .docx), printed, signed copy uploaded, verified by HR. */
export const DOCUMENT_STATUSES = ['generated', 'printed', 'signed', 'verified'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Every column but the two files. */
export const DOCUMENT = {
  id: true,
  employeeId: true,
  employmentId: true,
  contractId: true,
  endingId: true,
  slotKey: true,
  inputs: true,
  documentDate: true,
  fileName: true,
  sizeBytes: true,
  hasRestricted: true,
  status: true,
  templateVersion: { select: { version: true } },
  generatedBy: { select: { email: true } },
  generatedAt: true,
  printedBy: { select: { email: true } },
  printedAt: true,
  signedUploadedBy: { select: { email: true } },
  signedUploadedAt: true,
  verifiedBy: { select: { email: true } },
  verifiedAt: true,
  signedFileName: true,
  signedMime: true,
  signedSize: true,
  note: true,
} satisfies Prisma.GeneratedDocumentSelect;

export type DocumentRow = Prisma.GeneratedDocumentGetPayload<{ select: typeof DOCUMENT }>;

/** A generated document: its date as YYYY-MM-DD, who did each step (null for a step not done, or an account deleted). */
export function documentView(d: DocumentRow) {
  return {
    id: d.id,
    slotKey: d.slotKey,
    contractId: d.contractId,
    status: d.status as DocumentStatus,
    fileName: d.fileName,
    sizeBytes: d.sizeBytes,
    templateVersion: d.templateVersion.version,
    documentDate: fromDateOnly(d.documentDate),
    inputs: d.inputs as Record<string, string>,
    hasRestricted: d.hasRestricted,
    generatedBy: d.generatedBy,
    generatedAt: d.generatedAt,
    printedBy: d.printedBy,
    printedAt: d.printedAt,
    signedUploadedBy: d.signedUploadedBy,
    signedUploadedAt: d.signedUploadedAt,
    verifiedBy: d.verifiedBy,
    verifiedAt: d.verifiedAt,
    signedFileName: d.signedFileName,
    signedMime: d.signedMime,
    signedSize: d.signedSize,
    note: d.note,
  };
}

export type DocumentView = ReturnType<typeof documentView>;
