-- Pay raises during a contract, renewals with new pay, and raise requests (owner's decisions, 16 October 2026).
--
-- 1. A raise is a contract version, one of two ways, HR choosing per case ("i want to have the amendment option and to
-- terminate the current contract and generate a new one"): an amendment (kind 'amendment': the new pay on the same
-- contract from its start date, the effective date; the contract's end, no term of its own, no probation; numbered as
-- the contract with -A1, -A2 …), or a new contract (kind 'contract', its own term from the effective date). Every
-- version until now is a whole contract.
-- 2. A version that changes the pay, a raise or a renewal with new pay ("think about tracking the salary raises through
-- the employment period too"), has its reason and the CEO's step ("HR, then the CEO"): a draft HR sends, waiting for
-- the CEO, approved; returned is a draft with the CEO's reason. Only an approved one is signed. None until now.
-- 3. A promotion that comes with a raise: the job title and grade applied to the employment when it is signed.
-- 4. Social insurance ("From the next January unless amended in Form 2"): the insured wage follows a raise's pay from
-- the next 1 January, or from the 1st of a month HR records with the Form 2 filed.
-- 5. Raise requests ("a place to request raise by employee, or his manager or the HR, with a reason and to be going
-- through an approval cycle"): HR declines one or prepares the raise from it, whose CEO decision is the request's.

ALTER TABLE "contracts" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'contract',
  ADD COLUMN "raise_reason" TEXT,
  ADD COLUMN "approval" TEXT,
  ADD COLUMN "sent_at" TIMESTAMPTZ,
  ADD COLUMN "approved_by" UUID,
  ADD COLUMN "approved_at" TIMESTAMPTZ,
  ADD COLUMN "returned_reason" TEXT,
  ADD COLUMN "new_job_title_id" UUID,
  ADD COLUMN "new_grade_id" UUID,
  ADD COLUMN "form2_from" DATE,
  ADD CONSTRAINT "contracts_kind_check" CHECK ("kind" IN ('contract', 'amendment')),
  -- an amendment keeps the contract's term: no length of its own, no probation, never the first version
  ADD CONSTRAINT "contracts_amendment_check" CHECK ("kind" <> 'amendment' OR ("duration_months" IS NULL AND "probation_months" = 0 AND "version" > 1)),
  ADD CONSTRAINT "contracts_raise_reason_check" CHECK ("raise_reason" IN ('annual', 'promotion', 'adjustment', 'other')),
  ADD CONSTRAINT "contracts_approval_check" CHECK ("approval" IN ('draft', 'pending_ceo', 'approved')),
  -- the CEO's step goes with a reason, and only on a version after the first
  ADD CONSTRAINT "contracts_approval_reason_check" CHECK (("approval" IS NULL) = ("raise_reason" IS NULL) AND ("approval" IS NULL OR "version" > 1)),
  -- signed only once approved
  ADD CONSTRAINT "contracts_signed_approved_check" CHECK ("status" = 'draft' OR "approval" IS NULL OR "approval" = 'approved'),
  ADD CONSTRAINT "contracts_form2_from_check" CHECK ("form2_from" IS NULL OR (EXTRACT(DAY FROM "form2_from") = 1 AND "approval" IS NOT NULL));

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_new_job_title_id_fkey" FOREIGN KEY ("new_job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_new_grade_id_fkey" FOREIGN KEY ("new_grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "raise_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "requested_by" UUID,
    "requester" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "suggested_gross" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'with_hr',
    "contract_id" UUID,
    "declined_by" UUID,
    "declined_at" TIMESTAMPTZ,
    "declined_stage" TEXT,
    "decline_reason" TEXT,
    "done_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "raise_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "raise_requests_requester_check" CHECK ("requester" IN ('self', 'manager', 'hr')),
    CONSTRAINT "raise_requests_status_check" CHECK ("status" IN ('with_hr', 'with_ceo', 'approved', 'declined', 'done')),
    CONSTRAINT "raise_requests_reason_check" CHECK (length(btrim("reason")) > 0),
    -- the employee's or HR's suggestion, never a manager's
    CONSTRAINT "raise_requests_suggested_gross_check" CHECK ("suggested_gross" IS NULL OR ("suggested_gross" > 0 AND "requester" <> 'manager')),
    CONSTRAINT "raise_requests_declined_check" CHECK (("status" = 'declined') = ("declined_stage" IS NOT NULL) AND ("declined_stage" IS NULL OR "declined_stage" IN ('hr', 'ceo')))
);

CREATE UNIQUE INDEX "raise_requests_contract_id_key" ON "raise_requests"("contract_id");
CREATE INDEX "raise_requests_employee_id_idx" ON "raise_requests"("employee_id");
CREATE INDEX "raise_requests_status_idx" ON "raise_requests"("status");

ALTER TABLE "raise_requests" ADD CONSTRAINT "raise_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raise_requests" ADD CONSTRAINT "raise_requests_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raise_requests" ADD CONSTRAINT "raise_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "raise_requests" ADD CONSTRAINT "raise_requests_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "raise_requests" ADD CONSTRAINT "raise_requests_declined_by_fkey" FOREIGN KEY ("declined_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
