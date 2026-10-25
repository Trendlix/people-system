-- A day's hours as the sum of its check-in → check-out pairs, and people exempt from check-in (owner, 25 October 2026:
-- "on checkin and out several ttimes, the working hours to be calculated between the checkin and out only, not the first
-- and last"; asked, "Count the closed pairs, flag the open one" and "Months not yet paid"; then "allow me to select people
-- that are not eligable for attendance checkins and outs, trat them as if they achived their full working hours", asked,
-- "Optional check-in" and "Profile + a list in Check-in Setup"). The rules: packages/shared attendance.ts (pairPresses,
-- hoursCountedForPresses) and check-in-exemptions.ts. Written by hand.

-- 1. A day kept on the system's check-ins (or a correction's) keeps its pairs ([{ "in": ISO, "out": ISO }]), the break
--    between them in minutes, and the moment of a last check-in without a check-out. None on Zoho's days, and on the
--    days kept before this until the API's pass recounts them (apps/api/src/attendance/hours-by-pairs.service.ts: the
--    months whose payroll isn't with the CEO, approved or paid; Zoho's days never).
ALTER TABLE "attendance_days"
  ADD COLUMN "pairs" JSONB,
  ADD COLUMN "break_minutes" INTEGER,
  ADD COLUMN "open_at" TIMESTAMPTZ,
  ADD CONSTRAINT "attendance_days_pairs_check" CHECK ("pairs" IS NULL OR jsonb_typeof("pairs") = 'array'),
  ADD CONSTRAINT "attendance_days_break_minutes_check" CHECK ("break_minutes" IS NULL OR "break_minutes" >= 0);

-- 2. The periods exempt from check-in: a person, why (required), from a day to a day (none: no end), who added it and
--    when, who ended it and when, and when one ended before it started was cancelled (kept, never read: only a Super
--    Admin deletes records). One person's periods never overlap, the cancelled left out (the API checks it, under the
--    person's row).
CREATE TABLE "check_in_exemptions" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_by" UUID,
    "ended_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,

    CONSTRAINT "check_in_exemptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "check_in_exemptions_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 500),
    CONSTRAINT "check_in_exemptions_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date")
);

CREATE INDEX "check_in_exemptions_employee_id_start_date_idx" ON "check_in_exemptions"("employee_id", "start_date");

ALTER TABLE "check_in_exemptions" ADD CONSTRAINT "check_in_exemptions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "check_in_exemptions" ADD CONSTRAINT "check_in_exemptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "check_in_exemptions" ADD CONSTRAINT "check_in_exemptions_ended_by_fkey" FOREIGN KEY ("ended_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
