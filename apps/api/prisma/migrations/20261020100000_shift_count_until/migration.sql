-- Make-up hours (owner, 20 October 2026, asked "if an employee failed to complete 9 hours in a da, can he work extra
-- hours next day ? to raise his average?": "within the same month with no working hours to be counted after 8 PM even if
-- the check out was 11 PM / record the checkout time but count till the checkout window limit").

-- 1. A shift's "Count hours until": set, a day counts until that time and past the hours to work, so a long day fills
-- the month's short hours; null, as until now (the window's end and the grace, at most the hours to work). At or after
-- the shift's end and on the same day: before midnight, or on a shift that runs past midnight, before it starts again.
ALTER TABLE "shifts" ADD COLUMN "count_until" TIME(0),
  ADD CONSTRAINT "shifts_count_until_check" CHECK (
    "count_until" IS NULL OR (
      "count_until" >= "end_time"
      AND ("end_time" > "start_time" OR "count_until" < "start_time")
    )
  );

-- 2. The MORNING shift (9 hours within 9:00 AM to 7:00 PM) counts until 8:00 PM, as the owner said; every other shift
-- stays as it is until HR sets it.
UPDATE "shifts" SET "count_until" = '20:00'
WHERE lower("code") = 'morning'
  AND TIME '20:00' >= "end_time"
  AND ("end_time" > "start_time" OR TIME '20:00' < "start_time");
