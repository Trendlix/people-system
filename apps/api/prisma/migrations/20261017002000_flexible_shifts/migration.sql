-- Flexible shifts, and no overtime for now (owner, 16 October 2026).

-- 1. A shift's hours to work a day (owner, on the MORNING shift of 9:00 AM to 7:00 PM: "my company shift is to maintain
-- 9 hours within the shift window, its like flexible shift"): fewer than its window (start to end), the shift is
-- flexible, worked anywhere within the window. In half hours from 0.5, never more than the window (an end before the
-- start runs past midnight). Empty: the whole window, as until now, so nothing changes for a shift until HR sets it.
-- They are also the most hours attendance counts a day (owner: "maximum working hours to be recorded per day is 9 hours
-- between checkin and check out").
ALTER TABLE "shifts" ADD COLUMN "hours_per_day" DECIMAL(4,2),
  ADD CONSTRAINT "shifts_hours_per_day_check" CHECK (
    "hours_per_day" IS NULL OR (
      "hours_per_day" >= 0.5
      AND "hours_per_day" * 2 = trunc("hours_per_day" * 2)
      AND "hours_per_day" * 3600 <= EXTRACT(EPOCH FROM ("end_time" - "start_time")) + CASE WHEN "end_time" > "start_time" THEN 0 ELSE 86400 END
    )
  );

-- 2. Whether overtime is paid (owner: "No overtime for now"): off from now on. A run copies it with the other rules when
-- it is made or refreshed; the rules runs copied before have no switch and read as paying it, so their figures stay.
ALTER TABLE "payroll_settings" ADD COLUMN "pay_overtime" BOOLEAN NOT NULL DEFAULT false;
