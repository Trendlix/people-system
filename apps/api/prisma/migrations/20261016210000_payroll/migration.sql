-- Monthly payroll, phase 1 (owner's decisions, 16 October 2026): worked out the way the owner's payroll sheet ("Payroll -
-- SEP 26") does it, with its formula errors fixed. HR prepares a month's run, the CEO approves it (the CEO only), then
-- it is locked and HR marks it paid; salaries go by bank file: CIB's payroll system for CIB accounts, ACH for every
-- other bank.

-- 1. Registered with social insurance: payroll deducts the employee's 11% and counts the company's 18.75% only for
-- them. HR sets it on the Social Insurance tab; to start with, everyone with a social insurance number is registered.
ALTER TABLE "employees" ADD COLUMN "social_insured" BOOLEAN NOT NULL DEFAULT false;
UPDATE "employees" SET "social_insured" = true WHERE "insurance_no" IS NOT NULL;

-- 2. The payroll settings: one row, id 1. The rules each run copies (the sheet's: a month of 30 days, attendance from 90%
-- and a KPI average from 80% count as full, overtime above 110% at 1.5, a no-show day costs 2 days' pay), and the
-- company's side of the bank files: its 12-digit CIB account the salaries are paid from, the account's name as CIB has
-- it, and the ACH file's transaction purpose.
CREATE TABLE "payroll_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "day_divisor" INTEGER NOT NULL DEFAULT 30,
    "attendance_grace_percent" DECIMAL(5,2) NOT NULL DEFAULT 90,
    "kpi_grace_percent" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "overtime_above_percent" DECIMAL(5,2) NOT NULL DEFAULT 110,
    "overtime_rate" DECIMAL(4,2) NOT NULL DEFAULT 1.5,
    "no_show_day_multiplier" DECIMAL(4,2) NOT NULL DEFAULT 2,
    "cib_debit_account" TEXT,
    "cib_debit_account_name" TEXT,
    "ach_purpose" TEXT NOT NULL DEFAULT 'CASH',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_settings_one_row" CHECK ("id" = 1),
    CONSTRAINT "payroll_settings_day_divisor_check" CHECK ("day_divisor" BETWEEN 20 AND 31),
    CONSTRAINT "payroll_settings_attendance_grace_percent_check" CHECK ("attendance_grace_percent" BETWEEN 0 AND 100),
    CONSTRAINT "payroll_settings_kpi_grace_percent_check" CHECK ("kpi_grace_percent" BETWEEN 0 AND 100),
    CONSTRAINT "payroll_settings_overtime_above_percent_check" CHECK ("overtime_above_percent" BETWEEN 100 AND 200),
    CONSTRAINT "payroll_settings_overtime_rate_check" CHECK ("overtime_rate" BETWEEN 1 AND 5),
    CONSTRAINT "payroll_settings_no_show_day_multiplier_check" CHECK ("no_show_day_multiplier" BETWEEN 0 AND 10),
    CONSTRAINT "payroll_settings_cib_debit_account_check" CHECK ("cib_debit_account" ~ '^[0-9]{12}$'),
    CONSTRAINT "payroll_settings_ach_purpose_check" CHECK ("ach_purpose" ~ '^[A-Z0-9]{1,20}$')
);
INSERT INTO "payroll_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP);

-- 3. A month's run: one per month, kept by its first day. Its rules are copied from the settings when it is made and
-- when it is refreshed; the people left out then (no signed contract for the month …) are kept with it.
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rules" JSONB NOT NULL,
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID,
    "submitted_at" TIMESTAMPTZ,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "returned_reason" TEXT,
    "paid_on" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_runs_month_check" CHECK (EXTRACT(DAY FROM "month") = 1),
    CONSTRAINT "payroll_runs_status_check" CHECK ("status" IN ('draft', 'pending_ceo', 'approved', 'paid'))
);
CREATE UNIQUE INDEX "payroll_runs_month_key" ON "payroll_runs"("month");
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. One employee's pay in a run: its terms (the contract in force and the profile), the month's inputs HR typed and
-- the result, with its totals in columns of their own for sums. Salary data, restricted to HR, Finance and the CEO; the
-- bank details are copied when the CEO approves the run, restricted like employee_bank. A person, employment or
-- contract on any run stays on record.
CREATE TABLE "payroll_lines" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "department" TEXT,
    "job_title" TEXT,
    "employment_type" "employment_type" NOT NULL,
    "pay_basis" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "earned" DECIMAL(12,2) NOT NULL,
    "allowances" DECIMAL(12,2) NOT NULL,
    "employee_insurance" DECIMAL(12,2) NOT NULL,
    "employer_insurance" DECIMAL(12,2) NOT NULL,
    "monthly_tax" DECIMAL(12,2) NOT NULL,
    "martyrs_fund" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "released" DECIMAL(12,2) NOT NULL,
    "transfer" DECIMAL(12,2) NOT NULL,
    "company_cost" DECIMAL(12,2) NOT NULL,
    "on_hold" BOOLEAN NOT NULL DEFAULT false,
    "comments" TEXT,
    "bank_short" TEXT,
    "account_no" TEXT,
    "iban" TEXT,
    "holder_name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_lines_pay_basis_check" CHECK ("pay_basis" IN ('monthly', 'hourly'))
);
CREATE UNIQUE INDEX "payroll_lines_run_id_employee_id_key" ON "payroll_lines"("run_id", "employee_id");
CREATE INDEX "payroll_lines_employee_id_idx" ON "payroll_lines"("employee_id");
CREATE INDEX "payroll_lines_employment_id_idx" ON "payroll_lines"("employment_id");
CREATE INDEX "payroll_lines_contract_id_idx" ON "payroll_lines"("contract_id");
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
