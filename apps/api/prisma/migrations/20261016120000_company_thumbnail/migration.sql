-- A thumbnail beside the company logo (owner, 15 October 2026): a square brand mark, shown as the browser tab icon and
-- where the wide logo has no room. Kept like the logo: the image, its type and when it was uploaded (its version).
ALTER TABLE "company" ADD COLUMN "thumbnail" BYTEA,
ADD COLUMN "thumbnail_mime_type" TEXT,
ADD COLUMN "thumbnail_updated_at" TIMESTAMPTZ;
