-- Importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?"; asked, he chose "Both": the leave already
-- taken, recorded as approved, and each person's current balance, and "Our Excel template"; Zoho People's leave export is
-- read too, and "while importing make sure there will be no duplicates from the previous imported files"). The rules:
-- packages/shared leave-import.ts.
--
-- 1. Each file imported: the file, its fingerprint (the same file again is told), its source, its rows as read, who each
--    person is, a Zoho file's leave types as mapped, and when it was applied and undone.
-- 2. The leave an import made, and a Zoho row's ZOHO_LINK_ID, once only: Undo deletes the leave, so the row is free again.
-- 3. The opening balances an import set, as adjustments of the annual balance, removed with it by Undo.

-- 1.
CREATE TABLE "leave_imports" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "file_data" BYTEA NOT NULL,
    "source" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "people" JSONB NOT NULL,
    "type_map" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_by" UUID,
    "applied_at" TIMESTAMPTZ,
    "undone_by" UUID,
    "undone_at" TIMESTAMPTZ,

    CONSTRAINT "leave_imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_imports_source_check" CHECK ("source" IN ('template', 'zoho'))
);

CREATE INDEX "leave_imports_file_hash_idx" ON "leave_imports"("file_hash");

ALTER TABLE "leave_imports" ADD CONSTRAINT "leave_imports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_imports" ADD CONSTRAINT "leave_imports_applied_by_fkey" FOREIGN KEY ("applied_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_imports" ADD CONSTRAINT "leave_imports_undone_by_fkey" FOREIGN KEY ("undone_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2.
ALTER TABLE "leave_requests" ADD COLUMN "import_id" UUID;
ALTER TABLE "leave_requests" ADD COLUMN "zoho_link_id" TEXT;

CREATE UNIQUE INDEX "leave_requests_zoho_link_id_key" ON "leave_requests"("zoho_link_id");
CREATE INDEX "leave_requests_import_id_idx" ON "leave_requests"("import_id");

ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "leave_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3.
ALTER TABLE "leave_adjustments" ADD COLUMN "import_id" UUID;

CREATE INDEX "leave_adjustments_import_id_idx" ON "leave_adjustments"("import_id");

ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "leave_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
