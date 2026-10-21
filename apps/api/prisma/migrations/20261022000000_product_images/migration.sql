-- Product images on a draft from Claude (owner, 21 October 2026: "i want claude to add product image from its specs. is
-- this applicable?", then "let the mcp connector fetch the product photo and add it / yes build it"). Claude gives the
-- link to the maker's image (found with its web search); the website's MCP endpoint fetches it and the API keeps it on
-- the draft. The rules: packages/shared product-images.ts.
--
-- 1. An asset's photos get a kind: a photo of the item itself ('photo', every photo so far), or the maker's product
--    image ('product'), which keeps where it came from (its source page and link, both https) and its caption.
-- 2. A draft's product images: up to 3 a draft (the API counts them), a JPEG, PNG or WebP of 100 to 8000 pixels a side,
--    at most 5 MB, with the link and its source page. They move to the asset's photos when the draft is confirmed, and
--    are deleted when it is discarded (and with the draft, were one ever deleted).

-- 1.
ALTER TABLE "asset_photos" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'photo',
ADD COLUMN "source_page_url" TEXT,
ADD COLUMN "image_url" TEXT,
ADD COLUMN "caption" TEXT;
ALTER TABLE "asset_photos" ADD CONSTRAINT "asset_photos_kind_check" CHECK ("kind" IN ('photo', 'product'));
-- a product image always says where it came from; a photo of the item never does
ALTER TABLE "asset_photos" ADD CONSTRAINT "asset_photos_source_check" CHECK (
    ("kind" = 'product') = ("source_page_url" IS NOT NULL AND "image_url" IS NOT NULL)
    AND ("kind" = 'product' OR "caption" IS NULL)
);

-- 2.
CREATE TABLE "asset_draft_images" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "source_page_url" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "caption" TEXT,
    "added_by" UUID,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_draft_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_draft_images_position_check" CHECK ("position" >= 0),
    CONSTRAINT "asset_draft_images_type_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT "asset_draft_images_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880),
    CONSTRAINT "asset_draft_images_dimensions_check" CHECK ("width" BETWEEN 100 AND 8000 AND "height" BETWEEN 100 AND 8000),
    CONSTRAINT "asset_draft_images_urls_check" CHECK ("source_page_url" LIKE 'https://%' AND "image_url" LIKE 'https://%')
);

CREATE INDEX "asset_draft_images_draft_id_position_idx" ON "asset_draft_images"("draft_id", "position");

ALTER TABLE "asset_draft_images" ADD CONSTRAINT "asset_draft_images_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "asset_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_draft_images" ADD CONSTRAINT "asset_draft_images_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
