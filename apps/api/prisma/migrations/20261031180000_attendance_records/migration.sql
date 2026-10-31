-- A Super Admin removes one attendance record, and chooses which source a day uses (owner, 31 October 2026: "is there a
-- way to check the checkin records? even if imported from zoho and delete one of them?" — "as a super admin"; "Stays
-- removed"; "Pick which source counts", "zoho or system"). A removed system press is moved here whole (punch), so it is
-- put back as it was; a removed Zoho record by its moment and kind, left out by the nightly fetch and an import.
CREATE TABLE "attendance_record_removals" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,
    "punch" JSONB,
    "reason" TEXT NOT NULL,
    "removed_by" UUID,
    "removed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restored_by" UUID,
    "restored_at" TIMESTAMPTZ,
    CONSTRAINT "attendance_record_removals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_record_removals_source_check" CHECK ("source" IN ('system', 'zoho')),
    CONSTRAINT "attendance_record_removals_kind_check" CHECK ("kind" IN ('in', 'out')),
    CONSTRAINT "attendance_record_removals_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 500)
);
CREATE INDEX "attendance_record_removals_employee_id_date_idx" ON "attendance_record_removals"("employee_id", "date");
ALTER TABLE "attendance_record_removals" ADD CONSTRAINT "attendance_record_removals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_record_removals" ADD CONSTRAINT "attendance_record_removals_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_record_removals" ADD CONSTRAINT "attendance_record_removals_restored_by_fkey" FOREIGN KEY ("restored_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "attendance_day_sources" (
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "chosen_by" UUID,
    "chosen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_day_sources_pkey" PRIMARY KEY ("employee_id", "date"),
    CONSTRAINT "attendance_day_sources_source_check" CHECK ("source" IN ('zoho', 'system')),
    CONSTRAINT "attendance_day_sources_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 500)
);
ALTER TABLE "attendance_day_sources" ADD CONSTRAINT "attendance_day_sources_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_day_sources" ADD CONSTRAINT "attendance_day_sources_chosen_by_fkey" FOREIGN KEY ("chosen_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
