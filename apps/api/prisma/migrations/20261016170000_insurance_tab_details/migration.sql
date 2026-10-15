-- What social insurance Form 1 prints that is now each employee's own, set by HR on the profile's Social Insurance tab
-- (owner, 16 October 2026). All optional, each with what is printed while an employee has none:
-- * the subscription start (تاريخ بدء الاشتراك): else the current employment's join date;
-- * the wages of Form 1's three tables, salary data, seen and changed only with the right to see salaries:
--   - the basic wage (أجر أساسي، لحساب ٧٪ وفقاً لقانون العمل): else the company's default in the contract settings, 410
--     EGP to start with. The contract's own basic salary (the gross × its basic share) is unchanged;
--   - the insured wage (أجر / دخل الاشتراك): else the contract's insured salary. Within the year's insurable limits
--     (packages/shared contracts.ts), checked by the API;
--   - the comprehensive wage (الأجر الشامل، لحساب اشتراك التأمين الصحي الشامل): else the contract's gross and
--     allowances.
ALTER TABLE "employees" ADD COLUMN "insurance_start_date" DATE,
  ADD COLUMN "insurance_basic_wage" DECIMAL(12,2),
  ADD COLUMN "insurance_insured_wage" DECIMAL(12,2),
  ADD COLUMN "insurance_comprehensive_wage" DECIMAL(12,2),
  ADD CONSTRAINT "employees_insurance_basic_wage_check" CHECK ("insurance_basic_wage" > 0),
  ADD CONSTRAINT "employees_insurance_insured_wage_check" CHECK ("insurance_insured_wage" > 0),
  ADD CONSTRAINT "employees_insurance_comprehensive_wage_check" CHECK ("insurance_comprehensive_wage" > 0);

ALTER TABLE "contract_settings" ADD COLUMN "insurance_basic_default" DECIMAL(12,2) NOT NULL DEFAULT 410,
  ADD CONSTRAINT "contract_settings_insurance_basic_default_check" CHECK ("insurance_basic_default" > 0);
