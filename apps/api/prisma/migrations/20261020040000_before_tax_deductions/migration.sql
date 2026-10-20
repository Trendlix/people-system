-- Deductions before tax (owner, 20 October 2026, asked whether the employee's medical share, a recurring deduction, is
-- taken before or after tax: "Before Tax i think"). The rules: packages/shared payroll.ts and salary.ts.
--
-- 1. A recurring deduction may be "Deducted before tax (lowers taxable pay)", off by default: every one there is stays
--    after tax.
-- 2. Its months' Recurring deductions carry it: one before tax lowers the taxable pay before the income tax. Only a
--    Recurring deduction can be; every one there is stays after tax, as every other deduction is.
-- 3. The most of the employee's health insurance share that lowers their taxable pay in a year, by year (the Super
--    Admin sets it on Payroll Setup's rates set by law): not seeded, as the law's limit is the accountant's to give;
--    empty, no limit.

-- 1.
ALTER TABLE "recurring_deductions" ADD COLUMN "before_tax" BOOLEAN NOT NULL DEFAULT false;

-- 2.
ALTER TABLE "payroll_adjustments" ADD COLUMN "before_tax" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_before_tax_check"
    CHECK (NOT "before_tax" OR ("kind" = 'deduction' AND "type" = 'recurring'));

-- 3.
ALTER TABLE "payroll_law_years" ADD COLUMN "before_tax_health_limit" DECIMAL(12,2);
ALTER TABLE "payroll_law_years" ADD CONSTRAINT "payroll_law_years_before_tax_health_limit_check"
    CHECK ("before_tax_health_limit" IS NULL OR "before_tax_health_limit" > 0);
