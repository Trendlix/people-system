-- A freelancer's long day on a shift (owner, 3 November 2026: "if more than N Hours Count as Y Hours", "this rule may be
-- enables or disabled in a specific shift"): switched on or off, a day counted more than its hours counts as the hours
-- given; both hours or neither, in half hours, Y more than N. Switched on, both are given.
ALTER TABLE "shifts" ADD COLUMN "long_day_on" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shifts" ADD COLUMN "long_day_over_hours" DECIMAL(4,2);
ALTER TABLE "shifts" ADD COLUMN "long_day_counts_as" DECIMAL(4,2);
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_long_day_check" CHECK (
  ("long_day_over_hours" IS NULL AND "long_day_counts_as" IS NULL AND NOT "long_day_on")
  OR ("long_day_over_hours" IS NOT NULL AND "long_day_counts_as" IS NOT NULL
      AND "long_day_over_hours" >= 0.5 AND "long_day_over_hours" <= 24
      AND "long_day_counts_as" > "long_day_over_hours" AND "long_day_counts_as" <= 48)
);
