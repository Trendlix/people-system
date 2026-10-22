-- Practice KPI scorecards (owner, 22 October 2026: "i want to test the KPI's .. and it is locked to dates, HR and
-- Admin.. how?", choosing "Practice scorecards"; packages/shared kpi-practice.ts): HR or a Super Admin starts one for
-- anyone and any month, on a draft or a published version, and takes its steps standing in for each person in it. Not
-- counted anywhere: no deadline moves it on, nobody is told, never in payroll, the reports or the exports.
--
-- 1. A scorecard is a practice one, with who started it and when (both kept while it is; neither on a real one).
-- 2. One REAL scorecard a person and month: the unique index on (employee_id, month) becomes a partial one, WHERE NOT
--    practice, so a practice scorecard of October never stands in the way of October's real one opening on 1 November.
--    A plain index on the two columns stays for the lookups (Prisma's @@index).
-- 3. A step taken standing in, on a practice scorecard: for whom (the employee, the scorer's side, HR); none otherwise.

-- 1.
ALTER TABLE "kpi_scorecards" ADD COLUMN "practice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kpi_scorecards" ADD COLUMN "practice_by" UUID;
ALTER TABLE "kpi_scorecards" ADD COLUMN "practice_at" TIMESTAMPTZ;
ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_practice_by_fkey" FOREIGN KEY ("practice_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- a practice one has the moment it was started (its starter may be deleted since: SET NULL); a real one neither
ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_practice_check" CHECK (
    ("practice" AND "practice_at" IS NOT NULL) OR (NOT "practice" AND "practice_by" IS NULL AND "practice_at" IS NULL)
);

-- 2.
DROP INDEX "kpi_scorecards_employee_id_month_key";
CREATE INDEX "kpi_scorecards_employee_id_month_idx" ON "kpi_scorecards"("employee_id", "month");
CREATE UNIQUE INDEX "kpi_scorecards_one_real_a_month" ON "kpi_scorecards"("employee_id", "month") WHERE NOT "practice";

-- 3.
ALTER TABLE "kpi_scorecard_steps" ADD COLUMN "stood_in_for" TEXT;
ALTER TABLE "kpi_scorecard_steps" ADD CONSTRAINT "kpi_scorecard_steps_stood_in_for_check" CHECK ("stood_in_for" IS NULL OR "stood_in_for" IN ('employee', 'scorer', 'hr'));
