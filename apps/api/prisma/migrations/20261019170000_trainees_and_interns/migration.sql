-- Trainees and interns (owner, 19 October 2026). On the Employees list showing a trainee as Probation: "interns to be
-- labeled trainees instead of probation and their contracts are never renewed", then "or can be only renewed 1 time,
-- after that it should be converted to a full time contract. a new trainee contract can be issued after 6 months of the
-- expiration of the last trainee contract"; and "in case of trainee, we are not paying them salary, its just
-- transportation allowance. can i add the gross with 0?". The law's trainee (المتدرج) is paid (Labour Law 14/2025 Art.
-- 1(2): "لقاء أجر"; Art. 29: the last stage at least the minimum wage), so the owner chose an unpaid internship of its
-- own, outside the labour law. A trainee's training agreement and an intern's internship agreement have no probation
-- (Art. 90's is an employment contract's), are renewed once at most, then converted to a full-time contract on the
-- same employment, or end ("Training completed"). The rules: packages/shared employment-types.ts.
--
-- 1. The employment types: the unpaid internship, intern. A value added to an enum can't be used in the transaction that
--    added it, so the type is made again with it (as 20261018190000 did) and each column using it is cast; the checks
--    naming full_time are made again with it.
-- 2. Who may claim a reimbursement type: intern allowed too, and given to the types offered to trainees (yesterday's
--    trainees are today's interns, step 4).
-- 3. A version converting a trainee's or an intern's agreement to a full-time contract (converts_to): a whole contract
--    after the agreement, without training stages.
-- 4. The unpaid interns: the people migrated from Internship to Trainee yesterday are the owner's unpaid interns. Every
--    trainee employment none of whose contracts has training stages (a paid trainee's agreement has them) becomes an
--    intern's; its contracts pay no wage (the gross 0, monthly, nothing insured: no company social insurance, no typed
--    net), their allowances kept (the transportation allowance).
-- 5. No probation for a trainee or an intern: Probation becomes Active, and the probation end goes from their
--    employments and contracts (the months too); a draft job offer for one offers none.
-- 6. How a training or internship agreement ends with its term: the ending rule Training completed (its end reason
--    training_completed), nobody's notice, the agreement's last day the last working day.
-- Data fixes, not audited, as in the migrations before.

-- 1.
ALTER TYPE "employment_type" RENAME TO "employment_type_before_interns";
CREATE TYPE "employment_type" AS ENUM ('full_time', 'part_time', 'trainee', 'intern', 'freelance');

ALTER TABLE "employments" DROP CONSTRAINT "employments_paid_by_commission_check";
ALTER TABLE "job_offers" DROP CONSTRAINT "job_offers_paid_by_commission_check";
ALTER TABLE "employments" ALTER COLUMN "employment_type" TYPE "employment_type" USING ("employment_type"::TEXT::"employment_type");
ALTER TABLE "job_offers" ALTER COLUMN "employment_type" TYPE "employment_type" USING ("employment_type"::TEXT::"employment_type");
ALTER TABLE "payroll_lines" ALTER COLUMN "employment_type" TYPE "employment_type" USING ("employment_type"::TEXT::"employment_type");
DROP TYPE "employment_type_before_interns";
ALTER TABLE "employments" ADD CONSTRAINT "employments_paid_by_commission_check" CHECK (NOT "paid_by_commission" OR "employment_type" = 'full_time');
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_paid_by_commission_check" CHECK (NOT "paid_by_commission" OR "employment_type" = 'full_time');

-- 2.
ALTER TABLE "reimbursement_types" DROP CONSTRAINT "reimbursement_types_employment_types_check";
UPDATE "reimbursement_types" SET "employment_types" = array_append("employment_types", 'intern')
WHERE 'trainee' = ANY ("employment_types") AND NOT 'intern' = ANY ("employment_types");
ALTER TABLE "reimbursement_types" ADD CONSTRAINT "reimbursement_types_employment_types_check" CHECK ("employment_types" <@ ARRAY['full_time', 'part_time', 'trainee', 'intern', 'freelance']::TEXT[]);

-- 3.
ALTER TABLE "contracts" ADD COLUMN "converts_to" "employment_type";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_converts_to_check" CHECK (
    "converts_to" IS NULL OR ("converts_to" = 'full_time' AND "kind" = 'contract' AND "version" > 1 AND "trainee_stages" IS NULL)
);

-- 4.
UPDATE "employments" e SET "employment_type" = 'intern'
WHERE e."employment_type" = 'trainee'
  AND NOT EXISTS (
    SELECT 1 FROM "contracts" c
    WHERE c."employment_id" = e."id" AND c."trainee_stages" IS NOT NULL AND jsonb_array_length(c."trainee_stages") > 0
  );
UPDATE "contracts" c SET "gross_salary" = 0, "insured_salary" = 0, "net_salary" = NULL, "pay_basis" = 'monthly', "hourly_rate" = NULL, "hours_per_week" = NULL
FROM "employments" e
WHERE c."employment_id" = e."id" AND e."employment_type" = 'intern';

-- 5.
UPDATE "employments" SET "status" = 'active' WHERE "employment_type" IN ('trainee', 'intern') AND "status" = 'probation';
UPDATE "employments" SET "probation_end" = NULL WHERE "employment_type" IN ('trainee', 'intern') AND "probation_end" IS NOT NULL;
UPDATE "contracts" c SET "probation_months" = 0, "probation_end" = NULL
FROM "employments" e
WHERE c."employment_id" = e."id" AND e."employment_type" IN ('trainee', 'intern') AND (c."probation_months" <> 0 OR c."probation_end" IS NOT NULL);
UPDATE "job_offers" SET "probation_months" = 0 WHERE "employment_type" = 'trainee' AND "status" = 'draft' AND "probation_months" <> 0;

-- 6.
INSERT INTO "ending_rules" ("key", "label", "initiator", "notice_amount", "notice_unit", "pay_in_lieu", "end_reason", "source", "sort_order", "updated_at")
VALUES ('training_completed', 'Training completed', 'none', 0, 'days', false, 'training_completed', 'Labour Law Arts. 28–30; the internship agreement', 12, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
