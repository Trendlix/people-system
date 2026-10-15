-- Contracts and how an employment ends (the contracts module, phase 1). The owner's decisions of 15 October 2026,
-- checked against Labour Law No. 14 of 2025: every employment type has a fixed-term contract of a year, renewed in
-- writing before it expires; the first three months are probation, once per employer (Art. 90); an ending is recorded
-- and approved by HR, then approved by the CEO, and takes effect when HR completes it on or after the last working day.

-- 1. The defaults for new contracts: one row, id 1. Probation is capped at 3 months by the law (Art. 90).
CREATE TABLE "contract_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "probation_months" INTEGER NOT NULL DEFAULT 3,
    "duration_months" INTEGER NOT NULL DEFAULT 12,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contract_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contract_settings_one_row" CHECK ("id" = 1),
    CONSTRAINT "contract_settings_probation_months_check" CHECK ("probation_months" BETWEEN 0 AND 3),
    CONSTRAINT "contract_settings_duration_months_check" CHECK ("duration_months" BETWEEN 1 AND 60)
);
INSERT INTO "contract_settings" ("id", "probation_months", "duration_months", "updated_at") VALUES (1, 3, 12, CURRENT_TIMESTAMP);

-- 2. The ways an employment can end, as packages/shared ENDING_RULE_DEFAULTS has them, in ENDING_RULES order. HR tunes
-- the label, the notice, pay in lieu and whether each is offered. prisma/seed.ts adds the same rows when missing.
CREATE TABLE "ending_rules" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "initiator" TEXT NOT NULL,
    "notice_amount" INTEGER NOT NULL,
    "notice_unit" TEXT NOT NULL,
    "pay_in_lieu" BOOLEAN NOT NULL,
    "end_reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ending_rules_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "ending_rules_notice_amount_check" CHECK ("notice_amount" BETWEEN 0 AND 365)
);
INSERT INTO "ending_rules" ("key", "label", "initiator", "notice_amount", "notice_unit", "pay_in_lieu", "end_reason", "source", "sort_order", "updated_at") VALUES
  ('probation', 'Ending during probation', 'either', 2, 'weeks', false, 'terminated', 'Contract clause 4', 1, CURRENT_TIMESTAMP),
  ('resignation', 'Resignation', 'employee', 3, 'months', false, 'resigned', 'Labour Law Arts. 156, 161, 167; Decree 187/2025', 2, CURRENT_TIMESTAMP),
  ('non_renewal', 'Fixed term not renewed', 'company', 45, 'working_days', false, 'contract_ended', 'Contract clause 2', 3, CURRENT_TIMESTAMP),
  ('company_notice', 'Ended by the company with notice', 'company', 3, 'months', true, 'terminated', 'Labour Law Arts. 156–164', 4, CURRENT_TIMESTAMP),
  ('misconduct', 'Dismissal for serious misconduct (Labour Court)', 'company', 0, 'days', false, 'terminated', 'Labour Law Arts. 141–148', 5, CURRENT_TIMESTAMP),
  ('absence', 'Absence (deemed resignation)', 'company', 0, 'days', false, 'resigned', 'Labour Law Art. 166', 6, CURRENT_TIMESTAMP),
  ('mutual_agreement', 'Mutual agreement', 'either', 0, 'days', false, 'mutual_agreement', 'Decree 187/2025 Art. 6', 7, CURRENT_TIMESTAMP),
  ('family_reasons', 'Marriage, pregnancy or childbirth (employee)', 'employee', 0, 'days', false, 'resigned', 'Labour Law Art. 58', 8, CURRENT_TIMESTAMP),
  ('retirement', 'Retirement at 60', 'company', 0, 'days', false, 'retired', 'Labour Law Art. 171', 9, CURRENT_TIMESTAMP),
  ('death', 'Death', 'none', 0, 'days', false, 'deceased', 'Labour Law Art. 169', 10, CURRENT_TIMESTAMP),
  ('disability', 'Total disability', 'none', 0, 'days', false, 'disability', 'Labour Law Art. 170', 11, CURRENT_TIMESTAMP);

-- 3. Contract versions: version 1, then each renewal or change of terms. The salary columns are restricted (HR,
-- Finance, CEO). The job title, grade, department and shift are copied from the employment when signed.
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "employment_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "form" TEXT NOT NULL DEFAULT 'fixed',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "duration_months" INTEGER,
    "probation_months" INTEGER NOT NULL DEFAULT 0,
    "probation_end" DATE,
    "gross_salary" DECIMAL(12,2) NOT NULL,
    "basic_percent" INTEGER NOT NULL DEFAULT 80,
    "net_salary" DECIMAL(12,2),
    "insured_salary" DECIMAL(12,2) NOT NULL,
    "job_title_en" TEXT,
    "job_title_ar" TEXT,
    "grade_code" TEXT,
    "department_name" TEXT,
    "shift_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "signed_on" DATE,
    "insurance_filed_on" DATE,
    "labour_office_filed_on" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contracts_probation_months_check" CHECK ("probation_months" BETWEEN 0 AND 3)
);
CREATE UNIQUE INDEX "contracts_number_key" ON "contracts"("number");
CREATE UNIQUE INDEX "contracts_employment_id_version_key" ON "contracts"("employment_id", "version");
-- the contracts about to expire: signed (active) ones by end date
CREATE INDEX "contracts_status_end_date_idx" ON "contracts"("status", "end_date");
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. How an employment ends: recorded (and so approved) by HR, then approved or rejected by the CEO, then completed.
CREATE TABLE "employment_endings" (
    "id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "initiator" TEXT,
    "notice_given_on" DATE NOT NULL,
    "pay_in_lieu" BOOLEAN NOT NULL DEFAULT false,
    "last_working_day" DATE NOT NULL,
    "certified_office" TEXT,
    "certified_serial" TEXT,
    "certified_on" DATE,
    "decision_due_on" DATE,
    "reason" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_ceo',
    "hr_approved_by" UUID,
    "hr_approved_at" TIMESTAMPTZ,
    "ceo_decided_by" UUID,
    "ceo_decided_at" TIMESTAMPTZ,
    "ceo_note" TEXT,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employment_endings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employment_endings_employment_id_idx" ON "employment_endings"("employment_id");
-- the CEO's queue (pending_ceo) and the other lists by status
CREATE INDEX "employment_endings_status_idx" ON "employment_endings"("status");
CREATE INDEX "employment_endings_rule_key_idx" ON "employment_endings"("rule_key");
ALTER TABLE "employment_endings" ADD CONSTRAINT "employment_endings_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employment_endings" ADD CONSTRAINT "employment_endings_rule_key_fkey" FOREIGN KEY ("rule_key") REFERENCES "ending_rules"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employment_endings" ADD CONSTRAINT "employment_endings_hr_approved_by_fkey" FOREIGN KEY ("hr_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employment_endings" ADD CONSTRAINT "employment_endings_ceo_decided_by_fkey" FOREIGN KEY ("ceo_decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
