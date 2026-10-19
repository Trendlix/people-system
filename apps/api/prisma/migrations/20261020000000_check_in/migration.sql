-- Checking in on the system (owner, 19 October 2026, "Proceed with those": "Check-in through the system (phone or web
-- with the office location check, or a device) to replace Zoho"). The rules: packages/shared check-in.ts.
--
-- 1. The office's point and radius on Payroll Setup → Your Rules: a check-in within the radius is at the office,
--    outside it remote; no point yet: location unknown. 150 metres to start with, 20 to 5,000; both or neither of the
--    latitude and longitude.
-- 2. A kept day may come from the system's check-ins ('system') or, later, a fingerprint or face device ('device'); a
--    check-in's place may be unknown (refused or unavailable); a day's flags say a check-in broke its work arrangement's
--    rule (kept, never refused).
-- 3. Each press of Check in and Check out: the working day it counts on, in or out, the server's moment, office, remote
--    or unknown (never the coordinates), the reading's accuracy in metres, where they were expected and the flags.

-- 1.
ALTER TABLE "payroll_settings"
    ADD COLUMN "office_latitude" DECIMAL(9,6),
    ADD COLUMN "office_longitude" DECIMAL(9,6),
    ADD COLUMN "office_radius_metres" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_office_location_check" CHECK (
    ("office_latitude" IS NULL) = ("office_longitude" IS NULL)
    AND ("office_latitude" IS NULL OR "office_latitude" BETWEEN -90 AND 90)
    AND ("office_longitude" IS NULL OR "office_longitude" BETWEEN -180 AND 180)
    AND "office_radius_metres" BETWEEN 20 AND 5000
);

-- 2.
ALTER TABLE "attendance_days" ADD COLUMN "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "attendance_days" DROP CONSTRAINT "attendance_days_place_check";
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_place_check" CHECK ("place" IS NULL OR "place" IN ('office', 'remote', 'unknown'));
ALTER TABLE "attendance_days" DROP CONSTRAINT "attendance_days_source_check";
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_source_check" CHECK ("source" IN ('zoho', 'system', 'device'));
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_flags_check" CHECK ("flags" <@ ARRAY['outside_office', 'location_unknown']::TEXT[]);

-- 3.
CREATE TABLE "attendance_punches" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "place" TEXT NOT NULL,
    "accuracy_metres" INTEGER,
    "expected" TEXT NOT NULL,
    "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'system',
    "user_id" UUID,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_punches_kind_check" CHECK ("kind" IN ('in', 'out')),
    CONSTRAINT "attendance_punches_place_check" CHECK ("place" IN ('office', 'remote', 'unknown')),
    CONSTRAINT "attendance_punches_accuracy_check" CHECK ("accuracy_metres" IS NULL OR "accuracy_metres" >= 0),
    CONSTRAINT "attendance_punches_expected_check" CHECK ("expected" IN ('office', 'anywhere')),
    CONSTRAINT "attendance_punches_flags_check" CHECK ("flags" <@ ARRAY['outside_office', 'location_unknown']::TEXT[]),
    CONSTRAINT "attendance_punches_source_check" CHECK ("source" IN ('system', 'device'))
);

CREATE INDEX "attendance_punches_employee_id_date_idx" ON "attendance_punches"("employee_id", "date");

ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
