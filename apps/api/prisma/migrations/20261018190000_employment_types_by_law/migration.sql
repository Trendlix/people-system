-- Employment types by Labour Law No. 14 of 2025 (owner, 18 October 2026: "can we update the employment types based on
-- the labour law?"). Asked, the owner chose: Sales becomes Full-time with a "paid by commission" flag (the law's wage
-- includes "العمولة أو النسبة المئوية", Art. 1(4)(أ)); Internship becomes Trainee, the law's المتدرج (Art. 1(2): "كل من
-- التحق لدى صاحب عمل بقصد تعلم مهنة أو صنعة أو حرفة لقاء أجر"), whose contract is the written training agreement with
-- its stages and rising pay (Arts. 28–30); Freelance is kept, outside the labour law (Art. 1(1): a worker works "تحت
-- إدارته أو إشرافه"). Recorded too: the contract's length (fixed-term, the default; open-ended; for a specific job: Arts.
-- 87, 88, 155), the nature of the work (regular, temporary, casual, seasonal: Art. 1(6–8)), and the private sector's
-- minimum wage by year, which a trainee's last stage is paid at least (Art. 29). The rules: packages/shared
-- employment-types.ts.

-- 1. The new columns: paid by commission (full-time only) and the nature of the work, on employments and job offers.
ALTER TABLE "employments" ADD COLUMN "paid_by_commission" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "work_nature" TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE "job_offers" ADD COLUMN "paid_by_commission" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "work_nature" TEXT NOT NULL DEFAULT 'regular';

-- 2. A Sales employment or offer is a full-time one paid by commission: the flag first, while the type still says so.
UPDATE "employments" SET "paid_by_commission" = true WHERE "employment_type" = 'sales';
UPDATE "job_offers" SET "paid_by_commission" = true WHERE "employment_type" = 'sales';

-- 3. The employment types: Postgres can't drop an enum's value in place, so the new type is made and every column
-- using the old one (employments, job offers, payroll lines' copy) is cast to it: internship → trainee, sales →
-- full_time, the others as they are.
ALTER TYPE "employment_type" RENAME TO "employment_type_before_law";
CREATE TYPE "employment_type" AS ENUM ('full_time', 'part_time', 'trainee', 'freelance');

ALTER TABLE "employments" ALTER COLUMN "employment_type" TYPE "employment_type" USING (
    CASE "employment_type"::TEXT WHEN 'internship' THEN 'trainee' WHEN 'sales' THEN 'full_time' ELSE "employment_type"::TEXT END
)::"employment_type";
ALTER TABLE "job_offers" ALTER COLUMN "employment_type" TYPE "employment_type" USING (
    CASE "employment_type"::TEXT WHEN 'internship' THEN 'trainee' WHEN 'sales' THEN 'full_time' ELSE "employment_type"::TEXT END
)::"employment_type";
ALTER TABLE "payroll_lines" ALTER COLUMN "employment_type" TYPE "employment_type" USING (
    CASE "employment_type"::TEXT WHEN 'internship' THEN 'trainee' WHEN 'sales' THEN 'full_time' ELSE "employment_type"::TEXT END
)::"employment_type";

DROP TYPE "employment_type_before_law";

-- Paid by commission is for a full-time employment or offer only; the nature of the work one of the four.
ALTER TABLE "employments" ADD CONSTRAINT "employments_paid_by_commission_check" CHECK (NOT "paid_by_commission" OR "employment_type" = 'full_time');
ALTER TABLE "employments" ADD CONSTRAINT "employments_work_nature_check" CHECK ("work_nature" IN ('regular', 'temporary', 'casual', 'seasonal'));
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_paid_by_commission_check" CHECK (NOT "paid_by_commission" OR "employment_type" = 'full_time');
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_work_nature_check" CHECK ("work_nature" IN ('regular', 'temporary', 'casual', 'seasonal'));

-- 4. Who may claim a reimbursement type: the employment types mapped the same way, each once, in their order.
ALTER TABLE "reimbursement_types" DROP CONSTRAINT "reimbursement_types_employment_types_check";
UPDATE "reimbursement_types" r SET "employment_types" = (
    SELECT COALESCE(array_agg(m."type" ORDER BY m."first"), ARRAY[]::TEXT[])
    FROM (
        SELECT CASE u."type" WHEN 'internship' THEN 'trainee' WHEN 'sales' THEN 'full_time' ELSE u."type" END AS "type", min(u."n") AS "first"
        FROM unnest(r."employment_types") WITH ORDINALITY AS u("type", "n")
        GROUP BY 1
    ) m
)
WHERE r."employment_types" && ARRAY['internship', 'sales']::TEXT[];
ALTER TABLE "reimbursement_types" ADD CONSTRAINT "reimbursement_types_employment_types_check" CHECK ("employment_types" <@ ARRAY['full_time', 'part_time', 'trainee', 'freelance']::TEXT[]);

-- 5. A contract's length (CONTRACT_FORMS): fixed (every contract so far), open_ended (no end date and no duration: it
-- ends by notice, Art. 156) or specific_job (the job it is for, Art. 155, its end date optional); a trainee's training
-- stages ([{ name, months, pay }], Art. 29).
ALTER TABLE "contracts" ADD COLUMN "job_to_do" TEXT,
ADD COLUMN "trainee_stages" JSONB;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_form_check" CHECK ("form" IN ('fixed', 'open_ended', 'specific_job'));
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_open_ended_check" CHECK ("form" <> 'open_ended' OR ("end_date" IS NULL AND "duration_months" IS NULL));
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_job_to_do_check" CHECK (("form" = 'specific_job') = ("job_to_do" IS NOT NULL) AND ("job_to_do" IS NULL OR btrim("job_to_do") <> ''));
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_trainee_stages_check" CHECK ("trainee_stages" IS NULL OR jsonb_typeof("trainee_stages") = 'array');

-- 6. The minimum wage a month, by year (the Super Admin sets it on Payroll Setup's rates set by law): not seeded.
ALTER TABLE "payroll_law_years" ADD COLUMN "minimum_wage" DECIMAL(12,2);
ALTER TABLE "payroll_law_years" ADD CONSTRAINT "payroll_law_years_minimum_wage_check" CHECK ("minimum_wage" IS NULL OR "minimum_wage" > 0);
