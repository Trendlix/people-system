-- Where each press was (owner, 20 October 2026, of a Daily Attendance row listing every press: "simplify this, i want to
-- view if it is remote or office, and location link"; asked, "Yes, keep the spot", seen by "HR, CEO, Super Admin" and the
-- employee). The rules: packages/shared punch-location.ts.
--
-- 1. A press keeps the point where it was made, read only then (6 decimals, both or neither, within range): none on the
--    presses from before, nor on one without a reading. Its accuracy in metres was kept already.
-- 2. "Refuse check-ins and check-outs without a location" (owner, the same day: "i want a flag to restrict checkin and
--    out from unknown locations", then "Company switch + exceptions"): the switch on the payroll settings' row, edited on
--    Attendance → Check-in Setup, off to start with.
-- 3. "Can check in without a location" on an employment: HR's exemption from that switch.

-- 1.
ALTER TABLE "attendance_punches"
  ADD COLUMN "latitude" DECIMAL(9,6),
  ADD COLUMN "longitude" DECIMAL(9,6),
  ADD CONSTRAINT "attendance_punches_point_check" CHECK (
    ("latitude" IS NULL) = ("longitude" IS NULL)
    AND ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
    AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
  );

-- 2.
ALTER TABLE "payroll_settings" ADD COLUMN "refuse_without_location" BOOLEAN NOT NULL DEFAULT false;

-- 3.
ALTER TABLE "employments" ADD COLUMN "check_in_without_location" BOOLEAN NOT NULL DEFAULT false;
