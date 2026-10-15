import type { TemplateSlot, TemplateVersionStatus } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';

// What the template library sends: each slot with where it stands, and its versions. Never the file itself, which has
// its own endpoint.

/** Every column but the file. */
export const VERSION = {
  id: true,
  slotKey: true,
  version: true,
  fileName: true,
  sizeBytes: true,
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
} satisfies Prisma.TemplateVersionSelect;

export type VersionRow = Prisma.TemplateVersionGetPayload<{ select: typeof VERSION }>;

/** A version as the slot's history lists it. */
export function versionView(v: VersionRow) {
  return {
    id: v.id,
    version: v.version,
    fileName: v.fileName,
    sizeBytes: v.sizeBytes,
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
      uploadedAt: published.uploadedAt,
      publishedAt: published.publishedAt,
      publishedBy: published.publishedBy,
    },
    latestDraft:
      own && latest
        ? { id: latest.id, version: latest.version, fileName: latest.fileName, uploadedAt: latest.uploadedAt, unknownTags: latest.unknownTags, broken: latest.broken }
        : null,
    versionCount: own ? versions.length : 0,
  };
}
