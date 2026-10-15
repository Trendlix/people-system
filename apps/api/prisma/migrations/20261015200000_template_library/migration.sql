-- The document template library (spec §8; owner's request, 15 October 2026: "Start working on the templates tab; I need
-- to upload the templates"). HR uploads each Word file exactly as used today, with merge tags such as {{full_name_ar}}
-- where the data goes; the system never changes the wording, it only replaces the tags.

-- Each upload is a new version of its slot (packages/shared TEMPLATE_SLOTS, checked by the API), numbered 1, 2 … within
-- the slot. The file is kept in the database, like paperwork, so the daily backup includes it. The tags are read when it
-- is uploaded: the dictionary's (tags), the others (unknown_tags) and fragments that look like a tag but aren't one
-- (broken); a version with unknown or broken tags can't be published. A draft until it is published; publishing
-- retires the version in use, and at most one version per slot is published (checked by the API, in a transaction). A
-- version that was in use is kept, so documents made from it keep their version: only a draft can be deleted.
CREATE TABLE "template_versions" (
    "id" UUID NOT NULL,
    "slot_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "language" TEXT NOT NULL,
    "tags" TEXT[],
    "unknown_tags" TEXT[],
    "broken" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ,

    CONSTRAINT "template_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "template_versions_version_check" CHECK ("version" >= 1),
    CONSTRAINT "template_versions_language_check" CHECK ("language" IN ('ar', 'en')),
    CONSTRAINT "template_versions_status_check" CHECK ("status" IN ('draft', 'published', 'retired'))
);
-- one row per version of a slot; also finds a slot's versions
CREATE UNIQUE INDEX "template_versions_slot_key_version_key" ON "template_versions"("slot_key", "version");
-- who uploaded and who published are kept as long as the account is; a deleted account leaves them empty
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
