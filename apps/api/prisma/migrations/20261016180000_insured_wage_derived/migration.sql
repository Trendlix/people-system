-- The insured wage social insurance Form 1 prints (أجر / دخل الاشتراك) is no longer each employee's own. Owner's decision,
-- 16 October 2026: "Apply the insurance wage cap rule from the comprehensive wage, and the insured wage field to be
-- uneditable in the Social Insurance tab". It is the comprehensive wage Form 1 prints (the employee's own, else the
-- contract's gross and allowances) kept within the current year's insurable limits, worked out when printed
-- (packages/shared contracts.ts, insuredWageFrom). The contract's own insured salary, on its social insurance copy, is
-- unchanged.
ALTER TABLE "employees" DROP CONSTRAINT "employees_insurance_insured_wage_check",
  DROP COLUMN "insurance_insured_wage";
