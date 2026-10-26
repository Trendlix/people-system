-- Official duty recorded by HR and imported (owner, 26 October 2026, asked "how to apply or import official duty", then
-- what to add: "HR records it" and "Import (template + Zoho)"). The rules: packages/shared official-duty.ts and
-- leave-import.ts.
--
-- 1. An official duty HR recorded for someone, approved at once (past the 3-day limit too), with what it was recorded
--    past as said then; or one a leave import brought over.
-- 2. The import it came from, which the import's Undo removes it with (and Delete waits for), and its Zoho row's
--    ZOHO_LINK_ID, once only: imported again, it is a duplicate.
-- 3. The steps: leave's "recorded by HR", and "imported", beside those of 23 October 2026.

-- 1. and 2.
ALTER TABLE "od_requests"
    ADD COLUMN "recorded_by_hr" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "import_id" UUID,
    ADD COLUMN "zoho_link_id" TEXT;

CREATE INDEX "od_requests_import_id_idx" ON "od_requests"("import_id");
CREATE UNIQUE INDEX "od_requests_zoho_link_id_key" ON "od_requests"("zoho_link_id");

ALTER TABLE "od_requests" ADD CONSTRAINT "od_requests_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "leave_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. every kind the constraint held (20261023120000_official_duty), and the two new ones
ALTER TABLE "od_request_steps" DROP CONSTRAINT "od_request_steps_kind_check";
ALTER TABLE "od_request_steps" ADD CONSTRAINT "od_request_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled', 'imported'));
