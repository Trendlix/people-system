-- Zoho People's "Working from home" rows brought over by the leave import (owner, 21 October 2026, of the 85 approved
-- this year: "Yes, as approved WFH days"): each working day of a row a work-from-home day, not leave.
--
-- 1. The import a work-from-home day came from, which the import's Undo removes it with (and Delete waits for).
-- 2. Its Zoho row's ZOHO_LINK_ID with the day ("<link id>:<YYYY-MM-DD>"), once only: imported again, it is a duplicate.

-- 1. and 2.
ALTER TABLE "wfh_requests"
    ADD COLUMN "import_id" UUID,
    ADD COLUMN "zoho_link_id" TEXT;

CREATE INDEX "wfh_requests_import_id_idx" ON "wfh_requests"("import_id");
CREATE UNIQUE INDEX "wfh_requests_zoho_link_id_key" ON "wfh_requests"("zoho_link_id");

ALTER TABLE "wfh_requests" ADD CONSTRAINT "wfh_requests_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "leave_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
