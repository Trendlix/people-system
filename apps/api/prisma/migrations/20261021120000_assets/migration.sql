-- Assets (owner, 21 October 2026: "i want to add this module with a special permission to the system", with the "Asset
-- Register" spec, then "use the main ERP system specs .. dont stick to the MD file"): the studio's assets, who holds
-- them, their counts and their values, inside the People System. The whole data model of the module's five steps is made
-- here, in step 1, so the later steps don't change it much. The rules: packages/shared assets.ts; the module:
-- apps/api/src/assets.
--
-- 1. Each user's Assets access ("3 levels per user"): none, viewer, custodian, manager (a Super Admin is always a
--    manager, the CEO and Finance always at least viewers: worked out by the API, not kept).
-- 2. The asset settings, one row: the capitalization threshold (an asset cheaper than it is Expensed, book value 0).
-- 3. The rooms an asset is kept in (the spec's "locations": rooms, so they don't clash with the check-in locations),
--    their names unique whatever their case.
-- 4. The production kits, PK-KIT-A, PK-KIT-B …
-- 5. The counters the codes come from, one a prefix ("PK-CAM-", "PK-KIT-", "CUS-"), raised in the transaction that
--    gives a code (INSERT … ON CONFLICT … RETURNING), never lowered: a code is never given twice.
-- 6. The assets: PK-CAM-0003, never changed; group, type, class; status (custody only with its holder and record; a
--    consumable always available, kept by quantity; a kit only for a production kit asset; disposed only with its
--    disposal); the values in EGP (numeric(14,2)), the market value's low ≤ mid ≤ high.
-- 7. Their photos (up to 6, kept in the database as the employee file's papers are).
-- 8–10. Custody (step 3): the records (CUS-0042, a shoot with its return date or a long-term assignment), their items (an
--    asset out on one record at a time) and their signed forms.
-- 11. The maintenance log (step 4). 12. The stock moves (step 4). 13–14. The counts and their lines (step 5).

-- 1.
ALTER TABLE "users" ADD COLUMN "assets_access" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "users" ADD CONSTRAINT "users_assets_access_check" CHECK ("assets_access" IN ('none', 'viewer', 'custodian', 'manager'));

-- 2.
CREATE TABLE "asset_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "capitalization_threshold" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "asset_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_settings_one_row_check" CHECK ("id" = 1),
    CONSTRAINT "asset_settings_threshold_check" CHECK ("capitalization_threshold" >= 0)
);

ALTER TABLE "asset_settings" ADD CONSTRAINT "asset_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "asset_settings" ("id", "updated_at") VALUES (1, now());

-- 3.
CREATE TABLE "asset_rooms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "asset_rooms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_rooms_name_check" CHECK (btrim("name") <> '')
);

-- "Studio A" and "studio a" are the same room
CREATE UNIQUE INDEX "asset_rooms_name_lower_key" ON "asset_rooms"(lower("name"));

-- 4.
CREATE TABLE "asset_kits" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "asset_kits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_kits_code_check" CHECK ("code" ~ '^PK-KIT-[A-Z]+$'),
    CONSTRAINT "asset_kits_name_check" CHECK (btrim("name") <> '')
);

CREATE UNIQUE INDEX "asset_kits_code_key" ON "asset_kits"("code");

ALTER TABLE "asset_kits" ADD CONSTRAINT "asset_kits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5.
CREATE TABLE "asset_code_counters" (
    "prefix" TEXT NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "asset_code_counters_pkey" PRIMARY KEY ("prefix"),
    CONSTRAINT "asset_code_counters_last_check" CHECK ("last" >= 1)
);

-- 6.
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_group" TEXT NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_class" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "condition" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "room_id" UUID,
    "kit_id" UUID,
    "holder_id" UUID,
    "custody_id" UUID,
    "quantity" DECIMAL(12,2),
    "unit" TEXT,
    "reorder_level" DECIMAL(12,2),
    "purchase_date" DATE,
    "useful_life_years" INTEGER,
    "warranty_end" DATE,
    "purchase_price" DECIMAL(14,2),
    "supplier" TEXT,
    "invoice_no" TEXT,
    "price_low" DECIMAL(14,2),
    "market_value" DECIMAL(14,2),
    "price_high" DECIMAL(14,2),
    "price_note" TEXT,
    "price_updated_at" TIMESTAMPTZ,
    "labeled_at" TIMESTAMPTZ,
    "disposal_method" TEXT,
    "disposed_on" DATE,
    "disposal_amount" DECIMAL(14,2),
    "disposal_book_value" DECIMAL(14,2),
    "disposal_approved_by" TEXT,
    "disposal_notes" TEXT,
    "disposed_by" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assets_code_check" CHECK ("code" ~ '^(ST|PK|IT|OF|CS)-[A-Z]{2,4}-[0-9]{4,}$'),
    CONSTRAINT "assets_name_check" CHECK (btrim("name") <> ''),
    CONSTRAINT "assets_group_check" CHECK ("asset_group" IN ('studio', 'kit', 'it', 'office', 'consumable')),
    CONSTRAINT "assets_type_check" CHECK ("asset_type" ~ '^[A-Z]{2,4}$'),
    CONSTRAINT "assets_class_check" CHECK ("asset_class" IN ('fixed', 'current')),
    CONSTRAINT "assets_condition_check" CHECK ("condition" IS NULL OR "condition" IN ('new', 'excellent', 'good', 'used', 'needs_repair')),
    CONSTRAINT "assets_status_check" CHECK ("status" IN ('available', 'custody', 'repair', 'lost', 'disposed')),
    -- custody only through a custody record, with who holds it; never set by hand
    CONSTRAINT "assets_custody_check" CHECK (
        ("status" = 'custody' AND "holder_id" IS NOT NULL AND "custody_id" IS NOT NULL)
        OR ("status" <> 'custody' AND "holder_id" IS NULL AND "custody_id" IS NULL)
    ),
    -- a consumable is always available and kept by quantity; nothing else is
    CONSTRAINT "assets_consumable_status_check" CHECK ("asset_group" <> 'consumable' OR "status" = 'available'),
    CONSTRAINT "assets_quantity_check" CHECK (("asset_group" = 'consumable') = ("quantity" IS NOT NULL)),
    CONSTRAINT "assets_stock_fields_check" CHECK ("asset_group" = 'consumable' OR ("unit" IS NULL AND "reorder_level" IS NULL)),
    CONSTRAINT "assets_quantity_range_check" CHECK (("quantity" IS NULL OR "quantity" >= 0) AND ("reorder_level" IS NULL OR "reorder_level" >= 0)),
    -- a kit only for a production kit asset
    CONSTRAINT "assets_kit_check" CHECK ("kit_id" IS NULL OR "asset_group" = 'kit'),
    CONSTRAINT "assets_useful_life_check" CHECK ("useful_life_years" IS NULL OR "useful_life_years" BETWEEN 1 AND 50),
    CONSTRAINT "assets_warranty_check" CHECK ("warranty_end" IS NULL OR "purchase_date" IS NULL OR "warranty_end" >= "purchase_date"),
    CONSTRAINT "assets_money_check" CHECK (
        ("purchase_price" IS NULL OR "purchase_price" >= 0) AND ("price_low" IS NULL OR "price_low" >= 0)
        AND ("market_value" IS NULL OR "market_value" >= 0) AND ("price_high" IS NULL OR "price_high" >= 0)
        AND ("disposal_amount" IS NULL OR "disposal_amount" >= 0) AND ("disposal_book_value" IS NULL OR "disposal_book_value" >= 0)
    ),
    -- the market value's range: low ≤ mid ≤ high, where they are given
    CONSTRAINT "assets_market_range_check" CHECK (
        ("price_low" IS NULL OR "market_value" IS NULL OR "price_low" <= "market_value")
        AND ("market_value" IS NULL OR "price_high" IS NULL OR "market_value" <= "price_high")
        AND ("price_low" IS NULL OR "price_high" IS NULL OR "price_low" <= "price_high")
    ),
    -- disposed only by the dispose flow, with its method and day; nothing of a disposal on any other
    CONSTRAINT "assets_disposal_check" CHECK (
        ("status" = 'disposed' AND "disposal_method" IN ('sold', 'scrapped', 'written_off', 'donated') AND "disposed_on" IS NOT NULL)
        OR ("status" <> 'disposed' AND "disposal_method" IS NULL AND "disposed_on" IS NULL AND "disposal_amount" IS NULL AND "disposal_book_value" IS NULL)
    )
);

CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");

CREATE INDEX "assets_asset_group_status_idx" ON "assets"("asset_group", "status");

CREATE INDEX "assets_status_idx" ON "assets"("status");

CREATE INDEX "assets_room_id_idx" ON "assets"("room_id");

CREATE INDEX "assets_kit_id_idx" ON "assets"("kit_id");

CREATE INDEX "assets_holder_id_idx" ON "assets"("holder_id");

ALTER TABLE "assets" ADD CONSTRAINT "assets_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "asset_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "asset_kits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_disposed_by_fkey" FOREIGN KEY ("disposed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7.
CREATE TABLE "asset_photos" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_photos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_photos_position_check" CHECK ("position" >= 0),
    CONSTRAINT "asset_photos_type_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT "asset_photos_size_check" CHECK ("size_bytes" > 0)
);

CREATE INDEX "asset_photos_asset_id_position_idx" ON "asset_photos"("asset_id", "position");

ALTER TABLE "asset_photos" ADD CONSTRAINT "asset_photos_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_photos" ADD CONSTRAINT "asset_photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8.
CREATE TABLE "custody_records" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "employee_id" UUID NOT NULL,
    "purpose" TEXT,
    "due_date" DATE,
    "issued_by" UUID,
    "handed_over_by" UUID,
    "out_notes" TEXT,
    "terms" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "out_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "custody_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custody_records_code_check" CHECK ("code" ~ '^CUS-[0-9]{4,}$'),
    CONSTRAINT "custody_records_kind_check" CHECK ("kind" IN ('shoot', 'assignment')),
    -- a shoot needs its return date; a long-term assignment comes back at clearance (spec §6.2)
    CONSTRAINT "custody_records_due_date_check" CHECK (("kind" = 'shoot') = ("due_date" IS NOT NULL)),
    CONSTRAINT "custody_records_status_check" CHECK ("status" IN ('open', 'partial', 'closed')),
    CONSTRAINT "custody_records_closed_check" CHECK (("status" = 'closed') = ("closed_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "custody_records_code_key" ON "custody_records"("code");

CREATE INDEX "custody_records_employee_id_status_idx" ON "custody_records"("employee_id", "status");

CREATE INDEX "custody_records_status_idx" ON "custody_records"("status");

ALTER TABLE "custody_records" ADD CONSTRAINT "custody_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_records" ADD CONSTRAINT "custody_records_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_records" ADD CONSTRAINT "custody_records_handed_over_by_fkey" FOREIGN KEY ("handed_over_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- the asset's record now (made after the custody records)
ALTER TABLE "assets" ADD CONSTRAINT "assets_custody_id_fkey" FOREIGN KEY ("custody_id") REFERENCES "custody_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 9.
CREATE TABLE "custody_items" (
    "id" UUID NOT NULL,
    "custody_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "value_at_out" DECIMAL(14,2),
    "condition_out" TEXT,
    "accessories" TEXT,
    "returned_at" TIMESTAMPTZ,
    "return_condition" TEXT,
    "received_by" UUID,
    "return_notes" TEXT,

    CONSTRAINT "custody_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custody_items_value_check" CHECK ("value_at_out" IS NULL OR "value_at_out" >= 0),
    CONSTRAINT "custody_items_condition_out_check" CHECK ("condition_out" IS NULL OR "condition_out" IN ('new', 'excellent', 'good', 'used', 'needs_repair')),
    CONSTRAINT "custody_items_return_condition_check" CHECK ("return_condition" IS NULL OR "return_condition" IN ('good', 'damaged', 'missing')),
    -- back: when and in what state, together
    CONSTRAINT "custody_items_returned_check" CHECK (("returned_at" IS NULL) = ("return_condition" IS NULL))
);

CREATE INDEX "custody_items_asset_id_idx" ON "custody_items"("asset_id");

CREATE UNIQUE INDEX "custody_items_custody_id_asset_id_key" ON "custody_items"("custody_id", "asset_id");

-- an asset is out on one custody record at a time
CREATE UNIQUE INDEX "custody_items_one_open" ON "custody_items"("asset_id") WHERE "returned_at" IS NULL;

ALTER TABLE "custody_items" ADD CONSTRAINT "custody_items_custody_id_fkey" FOREIGN KEY ("custody_id") REFERENCES "custody_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_items" ADD CONSTRAINT "custody_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_items" ADD CONSTRAINT "custody_items_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 10.
CREATE TABLE "custody_files" (
    "id" UUID NOT NULL,
    "custody_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custody_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custody_files_type_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    CONSTRAINT "custody_files_size_check" CHECK ("size_bytes" > 0)
);

CREATE INDEX "custody_files_custody_id_idx" ON "custody_files"("custody_id");

ALTER TABLE "custody_files" ADD CONSTRAINT "custody_files_custody_id_fkey" FOREIGN KEY ("custody_id") REFERENCES "custody_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_files" ADD CONSTRAINT "custody_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 11.
CREATE TABLE "asset_maintenance" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "on_date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "vendor" TEXT,
    "cost" DECIMAL(14,2),
    "notes" TEXT,
    "custody_item_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_maintenance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_maintenance_kind_check" CHECK ("kind" IN ('repair', 'service', 'inspection', 'warranty_claim', 'upgrade')),
    CONSTRAINT "asset_maintenance_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0)
);

CREATE INDEX "asset_maintenance_asset_id_on_date_idx" ON "asset_maintenance"("asset_id", "on_date");

ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_custody_item_id_fkey" FOREIGN KEY ("custody_item_id") REFERENCES "custody_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 12.
CREATE TABLE "asset_stock_moves" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "delta" DECIMAL(12,2) NOT NULL,
    "quantity_after" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "by_user" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_stock_moves_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_stock_moves_delta_check" CHECK ("delta" <> 0),
    -- the quantity never goes below 0
    CONSTRAINT "asset_stock_moves_quantity_check" CHECK ("quantity_after" >= 0)
);

CREATE INDEX "asset_stock_moves_asset_id_at_idx" ON "asset_stock_moves"("asset_id", "at");

ALTER TABLE "asset_stock_moves" ADD CONSTRAINT "asset_stock_moves_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_stock_moves" ADD CONSTRAINT "asset_stock_moves_by_user_fkey" FOREIGN KEY ("by_user") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 13.
CREATE TABLE "asset_counts" (
    "id" UUID NOT NULL,
    "scope_kind" TEXT NOT NULL,
    "scope_group" TEXT,
    "scope_room_id" UUID,
    "scope_kit_id" UUID,
    "scope_label" TEXT NOT NULL,
    "counted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counted_by" UUID,
    "notes" TEXT,
    "expected" INTEGER NOT NULL,

    CONSTRAINT "asset_counts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_counts_scope_group_check" CHECK ("scope_group" IS NULL OR "scope_group" IN ('studio', 'kit', 'it', 'office', 'consumable')),
    -- counted by a group, a room or a kit: exactly the one it names
    CONSTRAINT "asset_counts_scope_check" CHECK (
        ("scope_kind" = 'group' AND "scope_group" IS NOT NULL AND "scope_room_id" IS NULL AND "scope_kit_id" IS NULL)
        OR ("scope_kind" = 'room' AND "scope_room_id" IS NOT NULL AND "scope_group" IS NULL AND "scope_kit_id" IS NULL)
        OR ("scope_kind" = 'kit' AND "scope_kit_id" IS NOT NULL AND "scope_group" IS NULL AND "scope_room_id" IS NULL)
    ),
    CONSTRAINT "asset_counts_expected_check" CHECK ("expected" >= 0)
);

CREATE INDEX "asset_counts_scope_kind_counted_at_idx" ON "asset_counts"("scope_kind", "counted_at" DESC);

ALTER TABLE "asset_counts" ADD CONSTRAINT "asset_counts_scope_room_id_fkey" FOREIGN KEY ("scope_room_id") REFERENCES "asset_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_counts" ADD CONSTRAINT "asset_counts_scope_kit_id_fkey" FOREIGN KEY ("scope_kit_id") REFERENCES "asset_kits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_counts" ADD CONSTRAINT "asset_counts_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 14.
CREATE TABLE "asset_count_lines" (
    "id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "result" TEXT NOT NULL,
    "lost_marked_at" TIMESTAMPTZ,
    "lost_marked_by" UUID,

    CONSTRAINT "asset_count_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_count_lines_result_check" CHECK ("result" IN ('found', 'missing', 'out')),
    -- "Mark lost" is for a missing one only (spec §6.5)
    CONSTRAINT "asset_count_lines_lost_check" CHECK ("lost_marked_at" IS NULL OR "result" = 'missing')
);

CREATE INDEX "asset_count_lines_asset_id_idx" ON "asset_count_lines"("asset_id");

CREATE UNIQUE INDEX "asset_count_lines_count_id_asset_id_key" ON "asset_count_lines"("count_id", "asset_id");

ALTER TABLE "asset_count_lines" ADD CONSTRAINT "asset_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "asset_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_count_lines" ADD CONSTRAINT "asset_count_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_count_lines" ADD CONSTRAINT "asset_count_lines_lost_marked_by_fkey" FOREIGN KEY ("lost_marked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
