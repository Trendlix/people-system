-- The social insurance occupation (كود المهنة on Form 1) is the employee's, not the job title's (owner's decision, 16
-- October 2026: "The insurance occupation is to be edited in the Social Insurance tab for each employee, not in the
-- job description"). Six digits of the social insurance table (packages/shared occupations.ts, checked by the API),
-- optional. Each employee is given the occupation their current job title carried, unless they already have one; then
-- the job titles lose theirs.
ALTER TABLE "employees" ADD COLUMN "occupation_code" CHAR(6),
  ADD CONSTRAINT "employees_occupation_code_check" CHECK ("occupation_code" ~ '^[0-9]{6}$');

-- at most one employment per person is current (no end date), so each employee gets one code at most
UPDATE "employees"
SET "occupation_code" = "job_titles"."occupation_code"
FROM "employments"
JOIN "job_titles" ON "job_titles"."id" = "employments"."job_title_id"
WHERE "employments"."employee_id" = "employees"."id"
  AND "employments"."end_date" IS NULL
  AND "job_titles"."occupation_code" IS NOT NULL
  AND "employees"."occupation_code" IS NULL;

ALTER TABLE "job_titles" DROP CONSTRAINT "job_titles_occupation_code_check",
  DROP COLUMN "occupation_code";
