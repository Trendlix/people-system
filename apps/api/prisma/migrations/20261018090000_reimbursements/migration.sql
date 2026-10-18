-- Reimbursements (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset up
-- conditions", and "in the setup i need to enter for it a cap"). HR sets up the types in Payroll Setup, each with its
-- conditions; an employee claims one; their direct manager, then HR, then Finance decide it (no manager: straight to
-- HR), each approving it, approving a lower amount or rejecting it, every step logged on the claim; Finance's approval
-- adds it, untaxed, to the next payroll as a Reimbursement addition. New tables only: nothing that is there changes.

-- A type and its conditions: caps a claim, a month and a year (more than 0; a claim's no more than a month's, a month's
-- no more than a year's), a receipt required or not, the days after the expense it must be claimed within (1 to 365),
-- and who may claim it: departments, grades and employment types (none: everyone).
CREATE TABLE "reimbursement_types" (
    "id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description" TEXT,
    "receipt_required" BOOLEAN NOT NULL DEFAULT true,
    "cap_per_claim" DECIMAL(12,2),
    "cap_per_month" DECIMAL(12,2),
    "cap_per_year" DECIMAL(12,2),
    "claim_within_days" INTEGER,
    "department_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "grade_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "employment_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reimbursement_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reimbursement_types_names_check" CHECK (btrim("name_en") <> '' AND btrim("name_ar") <> ''),
    CONSTRAINT "reimbursement_types_caps_check" CHECK (
        ("cap_per_claim" IS NULL OR "cap_per_claim" > 0)
        AND ("cap_per_month" IS NULL OR "cap_per_month" > 0)
        AND ("cap_per_year" IS NULL OR "cap_per_year" > 0)
        AND ("cap_per_claim" IS NULL OR "cap_per_month" IS NULL OR "cap_per_claim" <= "cap_per_month")
        AND ("cap_per_month" IS NULL OR "cap_per_year" IS NULL OR "cap_per_month" <= "cap_per_year")
        AND ("cap_per_claim" IS NULL OR "cap_per_year" IS NULL OR "cap_per_claim" <= "cap_per_year")
    ),
    CONSTRAINT "reimbursement_types_claim_within_days_check" CHECK ("claim_within_days" IS NULL OR "claim_within_days" BETWEEN 1 AND 365),
    CONSTRAINT "reimbursement_types_employment_types_check" CHECK ("employment_types" <@ ARRAY['full_time', 'part_time', 'internship', 'freelance', 'sales']::TEXT[])
);

-- A claim: the employee and the employment it was sent under, the type, the expense's date, the amount as claimed and
-- as last approved (more than 0, never more than claimed), what it was for, where it is, and the direct manager when it
-- was sent (with the manager: one is set). Rejected: at which stage, and why. Finance's approval: the addition made and
-- the month's first day.
CREATE TABLE "reimbursement_claims" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "expense_date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "approved_amount" DECIMAL(12,2),
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "manager_id" UUID,
    "rejected_stage" TEXT,
    "reject_reason" TEXT,
    "adjustment_id" UUID,
    "pay_month" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reimbursement_claims_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reimbursement_claims_amount_check" CHECK ("amount" > 0 AND ("approved_amount" IS NULL OR ("approved_amount" > 0 AND "approved_amount" <= "amount"))),
    CONSTRAINT "reimbursement_claims_description_check" CHECK (btrim("description") <> ''),
    CONSTRAINT "reimbursement_claims_status_check" CHECK ("status" IN ('with_manager', 'with_hr', 'with_finance', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT "reimbursement_claims_manager_check" CHECK ("status" <> 'with_manager' OR "manager_id" IS NOT NULL),
    CONSTRAINT "reimbursement_claims_rejected_check" CHECK (
        ("status" = 'rejected') = ("rejected_stage" IS NOT NULL)
        AND ("rejected_stage" IS NULL OR "rejected_stage" IN ('manager', 'hr', 'finance'))
    ),
    CONSTRAINT "reimbursement_claims_pay_month_check" CHECK ("pay_month" IS NULL OR EXTRACT(DAY FROM "pay_month") = 1)
);

-- Each step of a claim, in the order taken: sent (with the amount claimed), sent straight to HR, each stage's decision
-- (approve, approve_other, reject; the amount approved at that step), cancelled, added to payroll (with the month).
CREATE TABLE "reimbursement_claim_steps" (
    "id" BIGSERIAL NOT NULL,
    "claim_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT,
    "amount" DECIMAL(12,2),
    "comment" TEXT,
    "pay_month" DATE,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reimbursement_claim_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reimbursement_claim_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'manager_decision', 'hr_decision', 'finance_decision', 'cancelled', 'added_to_payroll')),
    -- the stages' decisions, and only they, have their decision
    CONSTRAINT "reimbursement_claim_steps_decision_check" CHECK (
        ("decision" IS NOT NULL) = ("kind" IN ('manager_decision', 'hr_decision', 'finance_decision'))
        AND ("decision" IS NULL OR "decision" IN ('approve', 'approve_other', 'reject'))
    ),
    CONSTRAINT "reimbursement_claim_steps_amount_check" CHECK ("amount" IS NULL OR "amount" > 0),
    CONSTRAINT "reimbursement_claim_steps_pay_month_check" CHECK ("pay_month" IS NULL OR EXTRACT(DAY FROM "pay_month") = 1)
);

-- A claim's receipts: photos or PDFs, kept in the database like the employee file.
CREATE TABLE "reimbursement_receipts" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reimbursement_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reimbursement_receipts_mime_type_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    CONSTRAINT "reimbursement_receipts_size_check" CHECK ("size_bytes" > 0)
);

CREATE UNIQUE INDEX "reimbursement_types_name_en_key" ON "reimbursement_types"("name_en");
CREATE UNIQUE INDEX "reimbursement_claims_adjustment_id_key" ON "reimbursement_claims"("adjustment_id");
CREATE INDEX "reimbursement_claims_employee_id_idx" ON "reimbursement_claims"("employee_id");
CREATE INDEX "reimbursement_claims_status_idx" ON "reimbursement_claims"("status");
CREATE INDEX "reimbursement_claims_manager_id_idx" ON "reimbursement_claims"("manager_id");
CREATE INDEX "reimbursement_claims_type_id_idx" ON "reimbursement_claims"("type_id");
CREATE INDEX "reimbursement_claim_steps_claim_id_idx" ON "reimbursement_claim_steps"("claim_id");
CREATE INDEX "reimbursement_receipts_claim_id_idx" ON "reimbursement_receipts"("claim_id");

ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "reimbursement_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "payroll_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claim_steps" ADD CONSTRAINT "reimbursement_claim_steps_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "reimbursement_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claim_steps" ADD CONSTRAINT "reimbursement_claim_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reimbursement_receipts" ADD CONSTRAINT "reimbursement_receipts_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "reimbursement_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
