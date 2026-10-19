-- Attendance imported from Zoho People (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now,
-- replace it later"): its daily attendance entries read on a draft payroll run, people matched by name, the days kept,
-- the run's lines filled. The rules: packages/shared attendance-import.ts.
--
-- 1. An employee's Zoho Employee Id, once HR confirmed a link: the next import matches them by it.
-- 2. The office's addresses as Zoho writes a check-in's location ("13 and 17 al mahrouki is also in office"), HR's to
--    change on Payroll Setup: a check-in at one of them is a day at the office, anywhere else remote.
-- 3. The inputs an import filled on a payroll line, for the grid to say "from Zoho".
-- 4. The files read on a run, until applied: each person's days (office or remote, never an address) and who they are.
-- 5. Each day of attendance kept, one a person, day and source.

-- 1.
ALTER TABLE "employees" ADD COLUMN "zoho_people_id" TEXT;
CREATE UNIQUE INDEX "employees_zoho_people_id_key" ON "employees"("zoho_people_id");

-- 2.
ALTER TABLE "payroll_settings" ADD COLUMN "office_addresses" TEXT[] DEFAULT ARRAY['Trendlix', '13, Al Doctor Al Mahrouqi Street', '15, Al Doctor Al Mahrouqi Street', '17, Al Doctor Al Mahrouqi Street']::TEXT[];

-- 3.
ALTER TABLE "payroll_lines" ADD COLUMN "attendance_import" JSONB;

-- 4.
CREATE TABLE "attendance_imports" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'zoho',
    "files" JSONB NOT NULL,
    "people" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_by" UUID,
    "applied_at" TIMESTAMPTZ,

    CONSTRAINT "attendance_imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_imports_source_check" CHECK ("source" IN ('zoho')),
    CONSTRAINT "attendance_imports_month_check" CHECK (extract(day FROM "month") = 1)
);

-- 5.
CREATE TABLE "attendance_days" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "check_in" TIMESTAMPTZ,
    "check_out" TIMESTAMPTZ,
    "status" TEXT NOT NULL,
    "zoho_status" TEXT,
    "place" TEXT,
    "permission_hours" DECIMAL(4,2),
    "hours_counted" DECIMAL(5,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'zoho',
    "import_id" UUID,
    "imported_by" UUID,
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_days_status_check" CHECK ("status" IN ('worked', 'absent', 'rest', 'holiday', 'leave', 'zoho_leave', 'no_check_in')),
    CONSTRAINT "attendance_days_place_check" CHECK ("place" IS NULL OR "place" IN ('office', 'remote')),
    CONSTRAINT "attendance_days_hours_check" CHECK ("hours_counted" >= 0 AND ("permission_hours" IS NULL OR "permission_hours" >= 0)),
    CONSTRAINT "attendance_days_source_check" CHECK ("source" IN ('zoho'))
);

CREATE INDEX "attendance_imports_run_id_idx" ON "attendance_imports"("run_id");
CREATE INDEX "attendance_days_date_idx" ON "attendance_days"("date");
CREATE UNIQUE INDEX "attendance_days_employee_id_date_source_key" ON "attendance_days"("employee_id", "date", "source");

ALTER TABLE "attendance_imports" ADD CONSTRAINT "attendance_imports_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_imports" ADD CONSTRAINT "attendance_imports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_imports" ADD CONSTRAINT "attendance_imports_applied_by_fkey" FOREIGN KEY ("applied_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "attendance_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
