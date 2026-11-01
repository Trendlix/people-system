-- The app's hourly location while checked in (owner, 1 November 2026: "can the devices ping every 1 hour their location?
-- and flag if someone is not in the checked in location?"; chose "Silent automatic ping"): the company's switch, off
-- until HR turns it on, and each ping read against the check-in it follows.
ALTER TABLE "payroll_settings" ADD COLUMN "location_pings" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "attendance_pings" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "punch_id" UUID,
    "status" TEXT NOT NULL,
    "off_reason" TEXT,
    "place" TEXT,
    "location_name" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "accuracy_metres" INTEGER,
    "distance_metres" INTEGER,
    "mock" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "attendance_pings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_pings_status_check" CHECK ("status" IN ('at_place', 'away', 'unknown', 'off')),
    CONSTRAINT "attendance_pings_off_reason_check" CHECK ("off_reason" IS NULL OR "off_reason" IN ('permission', 'service')),
    CONSTRAINT "attendance_pings_point_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL))
);

CREATE INDEX "attendance_pings_employee_id_date_idx" ON "attendance_pings"("employee_id", "date");
CREATE INDEX "attendance_pings_employee_id_at_idx" ON "attendance_pings"("employee_id", "at");

ALTER TABLE "attendance_pings" ADD CONSTRAINT "attendance_pings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_pings" ADD CONSTRAINT "attendance_pings_punch_id_fkey" FOREIGN KEY ("punch_id") REFERENCES "attendance_punches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
