-- Flexible days (owner, 31 October 2026): a shift worked on any N of its working days a week, N fewer than them; null:
-- every working day, as before.
ALTER TABLE "shifts" ADD COLUMN "days_per_week" SMALLINT,
  ADD CONSTRAINT "shifts_days_per_week_check" CHECK (
    "days_per_week" IS NULL OR ("days_per_week" >= 1 AND "days_per_week" < cardinality("working_days"))
  );
