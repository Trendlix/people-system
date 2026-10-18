-- The Labour Law's limits on what is deducted from the pay (Law No. 14 of 2025), read with the owner on 18 October 2026,
-- who decided (owner, 18 October 2026, after reading the law: "Block above 10%", "Warn above 25%, record the consent").

-- Art. 113: a month's installments of advances and loans may take at most 10% of the wage. Payroll Setup's share of
-- the pay, until now a warning at 1 to 100 percent (none: no warning), becomes that limit and is renamed so: 1 to 10,
-- 10 to start with, lower if the company sets it so, never higher. A share set above 10 becomes the law's 10, and none
-- set becomes 10 too, as the law applies either way; one of 1 to 10 is kept.
ALTER TABLE "payroll_settings" DROP CONSTRAINT IF EXISTS "payroll_settings_installment_warn_percent_check";
ALTER TABLE "payroll_settings" RENAME COLUMN "installment_warn_percent" TO "installment_limit_percent";
UPDATE "payroll_settings" SET "installment_limit_percent" = 10 WHERE "installment_limit_percent" IS NULL OR "installment_limit_percent" > 10;
ALTER TABLE "payroll_settings" ALTER COLUMN "installment_limit_percent" SET DEFAULT 10;
ALTER TABLE "payroll_settings" ALTER COLUMN "installment_limit_percent" SET NOT NULL;
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_installment_limit_percent_check" CHECK ("installment_limit_percent" BETWEEN 1 AND 10);

-- Art. 114: a deduction the employee agrees to needs their written consent. HR records it is on file for each recurring
-- deduction (when, and who), and may attach the signed consent, kept in the employee file as a paper of the kind
-- deduction_consent. Those set up before have none until HR records it.
ALTER TABLE "recurring_deductions" ADD COLUMN "consent_recorded_at" TIMESTAMPTZ;
ALTER TABLE "recurring_deductions" ADD COLUMN "consent_recorded_by" UUID;
ALTER TABLE "recurring_deductions" ADD COLUMN "consent_paperwork_id" UUID;

ALTER TABLE "recurring_deductions" ADD CONSTRAINT "recurring_deductions_consent_recorded_by_fkey" FOREIGN KEY ("consent_recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_deductions" ADD CONSTRAINT "recurring_deductions_consent_paperwork_id_fkey" FOREIGN KEY ("consent_paperwork_id") REFERENCES "paperwork_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- who recorded it, and the signed consent, only with the time it was recorded
ALTER TABLE "recurring_deductions" ADD CONSTRAINT "recurring_deductions_consent_check" CHECK (
    "consent_recorded_at" IS NOT NULL OR ("consent_recorded_by" IS NULL AND "consent_paperwork_id" IS NULL)
);
