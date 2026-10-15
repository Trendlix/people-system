import type { PdfField, PdfPageSize, TemplateSlot, TemplateVersionStatus } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { formatOf } from './template-file.js';

// What the template library sends: each slot with where it stands, and its versions. Never the file itself, which has
// its own endpoint.

/** Every column but the file. */
export const VERSION = {
  id: true,
  slotKey: true,
  version: true,
  fileName: true,
  sizeBytes: true,
  format: true,
  pdfPages: true,
  pdfFields: true,
  language: true,
  tags: true,
  unknownTags: true,
  broken: true,
  status: true,
  note: true,
  uploadedBy: { select: { email: true } },
  uploadedAt: true,
  publishedBy: { select: { email: true } },
  publishedAt: true,
  _count: { select: { documents: true, offers: true } },
} satisfies Prisma.TemplateVersionSelect;

export type VersionRow = Prisma.TemplateVersionGetPayload<{ select: typeof VERSION }>;

/** A PDF version's pages as shown, as kept (none for a Word version). */
export const pagesOf = (v: Pick<VersionRow, 'pdfPages'>): PdfPageSize[] => (Array.isArray(v.pdfPages) ? (v.pdfPages as unknown as PdfPageSize[]) : []);

/** A PDF version's fields, as kept (none for a Word version). */
export const fieldsOf = (v: Pick<VersionRow, 'pdfFields'>): PdfField[] => (Array.isArray(v.pdfFields) ? (v.pdfFields as unknown as PdfField[]) : []);

/** A version as the slot's history lists it. */
export function versionView(v: VersionRow) {
  const format = formatOf(v.format);
  return {
    id: v.id,
    version: v.version,
    fileName: v.fileName,
    sizeBytes: v.sizeBytes,
    /** docx: a Word template with {{tags}}; pdf: a form with its fields placed on it (owner's decision, 15 October 2026). */
    format,
    /** A PDF's pages and the fields placed on it; null for a Word version. */
    pageCount: format === 'pdf' ? pagesOf(v).length : null,
    fieldCount: format === 'pdf' ? fieldsOf(v).length : null,
    language: v.language,
    tags: v.tags,
    unknownTags: v.unknownTags,
    broken: v.broken,
    status: v.status as TemplateVersionStatus,
    note: v.note,
    uploadedBy: v.uploadedBy,
    uploadedAt: v.uploadedAt,
    publishedBy: v.publishedBy,
    publishedAt: v.publishedAt,
    /** Documents and job offers made from it: a version that was used is kept with them, never deleted. */
    usedBy: v._count.documents + v._count.offers,
  };
}

export type SlotStatus = 'missing' | 'draft' | 'published';

/**
 * A slot with where it stands, from its versions (any order). The version in use is the published one; the latest
 * draft is the newest draft uploaded after it (an older draft would only put back an older file). A copy (copyOf) is
 * printed from its source's file, so it is given its source's versions: it stands where its source stands, and has no
 * versions or drafts of its own.
 */
export function slotView(slot: TemplateSlot, versions: readonly VersionRow[]) {
  const published = versions.find((v) => v.status === 'published') ?? null;
  const drafts = versions.filter((v) => v.status === 'draft' && (!published || v.version > published.version));
  const latest = drafts.reduce<VersionRow | null>((a, v) => (!a || v.version > a.version ? v : a), null);
  const status: SlotStatus = published ? 'published' : versions.some((v) => v.status === 'draft') ? 'draft' : 'missing';
  const own = !slot.copyOf;
  return {
    key: slot.key,
    name: slot.name,
    folder: slot.folder,
    language: slot.language,
    appliesTo: slot.appliesTo,
    triggers: slot.triggers,
    signers: slot.signers,
    copyOf: slot.copyOf ?? null,
    overrides: slot.overrides ?? null,
    status,
    published: published && {
      id: published.id,
      version: published.version,
      fileName: published.fileName,
      format: formatOf(published.format),
      uploadedAt: published.uploadedAt,
      publishedAt: published.publishedAt,
      publishedBy: published.publishedBy,
    },
    latestDraft:
      own && latest
        ? {
            id: latest.id,
            version: latest.version,
            fileName: latest.fileName,
            format: formatOf(latest.format),
            // a PDF's fields placed so far: it is published once it has some
            fieldCount: formatOf(latest.format) === 'pdf' ? fieldsOf(latest).length : null,
            uploadedAt: latest.uploadedAt,
            unknownTags: latest.unknownTags,
            broken: latest.broken,
          }
        : null,
    versionCount: own ? versions.length : 0,
  };
}
