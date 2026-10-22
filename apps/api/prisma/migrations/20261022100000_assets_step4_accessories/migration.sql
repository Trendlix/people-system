-- Assets, step 4 (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal") and accessories (owner,
-- 22 October 2026: "and for the assets, i think we might need to add accessories under assets, like laptop charger under
-- the charger, DJI ronin accessories , etc..."; asked how, "Both kinds"). The rules: packages/shared
-- asset-accessories.ts and asset-upkeep.ts; the module: apps/api/src/assets. The stock moves, the maintenance log and the
-- disposal columns were made with step 1; this adds what accessories need, and keeps a disposed asset out of any kit.
--
-- 1. An asset's accessories' checklist: small things that come with it (a charger, cables, a case), in order, each with
--    how many and, when it has one, a serial; at most 30 an asset (checked by the API). Deleted with the asset.
-- 2. Attached assets: an asset of its own (its own code and label) attached to a main one, going out with it; one level
--    only (checked by the API, under the rows' locks), never to itself, never a consumable, never a disposed one.
-- 3. A custody item keeps the accessories that went out with it (a snapshot: the checklist may change later) and, once
--    back, those that didn't come back (an empty list: all did), which HR may turn into a deduction.
-- 4. A disposed asset is in no kit (disposing of it takes it out).

-- 1.
CREATE TABLE "asset_accessories" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "serial" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "asset_accessories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_accessories_position_check" CHECK ("position" >= 0),
    CONSTRAINT "asset_accessories_name_check" CHECK (btrim("name") <> '' AND length("name") <= 80),
    CONSTRAINT "asset_accessories_quantity_check" CHECK ("quantity" BETWEEN 1 AND 999),
    CONSTRAINT "asset_accessories_serial_check" CHECK ("serial" IS NULL OR length("serial") <= 80),
    CONSTRAINT "asset_accessories_notes_check" CHECK ("notes" IS NULL OR length("notes") <= 300)
);

CREATE UNIQUE INDEX "asset_accessories_asset_id_position_key" ON "asset_accessories"("asset_id", "position");

ALTER TABLE "asset_accessories" ADD CONSTRAINT "asset_accessories_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2.
ALTER TABLE "assets" ADD COLUMN "parent_asset_id" UUID;

ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_self_check" CHECK ("parent_asset_id" IS NULL OR "parent_asset_id" <> "id");
ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_group_check" CHECK ("parent_asset_id" IS NULL OR "asset_group" <> 'consumable');
ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_disposed_check" CHECK ("parent_asset_id" IS NULL OR "status" <> 'disposed');

CREATE INDEX "assets_parent_asset_id_idx" ON "assets"("parent_asset_id");

ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_asset_id_fkey" FOREIGN KEY ("parent_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3.
ALTER TABLE "custody_items" ADD COLUMN "accessories_out" JSONB,
ADD COLUMN "accessories_missing" JSONB;

ALTER TABLE "custody_items" ADD CONSTRAINT "custody_items_accessories_out_check" CHECK ("accessories_out" IS NULL OR jsonb_typeof("accessories_out") = 'array');
ALTER TABLE "custody_items" ADD CONSTRAINT "custody_items_accessories_missing_check" CHECK (
    "accessories_missing" IS NULL OR (jsonb_typeof("accessories_missing") = 'array' AND "returned_at" IS NOT NULL)
);

-- 4.
UPDATE "assets" SET "kit_id" = NULL WHERE "status" = 'disposed' AND "kit_id" IS NOT NULL;

ALTER TABLE "assets" ADD CONSTRAINT "assets_disposed_kit_check" CHECK ("status" <> 'disposed' OR "kit_id" IS NULL);
