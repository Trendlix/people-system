-- Payroll: Additions / Deductions and Unsettled (owner, 17 October 2026: "make the Payroll in the side tab a main title
-- below it - Unsettled - Additions / Deductions"). Asked, the owner chose: additions and deductions are one-off amounts
-- per employee and month (not recurring); Unsettled lists the runs not yet paid, the lines on hold not paid out since,
-- the final settlements of people who left, and the advances and loans still being recovered. Salary data, restricted to
-- HR, Finance and the CEO like the payroll lines. New tables only: nothing that is there changes.

-- A one-off addition or deduction on an employee's pay for a month: its type by kind (additions taxed but for a
-- reimbursement, other as HR chooses; deductions all after tax), an amount of more than 0, the reason, and for an
-- advance's recovery or a loan's installment the advance or loan it recovers. Pending, applied to a run line, or
-- cancelled.
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "taxed" BOOLEAN NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "advance_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "line_id" UUID,
    "applied_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_adjustments_month_check" CHECK (EXTRACT(DAY FROM "month") = 1),
    CONSTRAINT "payroll_adjustments_type_check" CHECK (
        ("kind" = 'addition' AND "type" IN ('bonus', 'commission', 'incentive', 'correction', 'reimbursement', 'other'))
        OR ("kind" = 'deduction' AND "type" IN ('penalty', 'damage_loss', 'advance_recovery', 'loan_installment', 'other') AND NOT "taxed")
    ),
    CONSTRAINT "payroll_adjustments_advance_check" CHECK (("type" IN ('advance_recovery', 'loan_installment')) = ("advance_id" IS NOT NULL)),
    CONSTRAINT "payroll_adjustments_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "payroll_adjustments_status_check" CHECK ("status" IN ('pending', 'applied', 'cancelled'))
);

-- An advance or a loan, recovered by the deductions linked to it; open while something is outstanding.
CREATE TABLE "payroll_advances" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "given_on" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "plan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "settled_at" TIMESTAMPTZ,
    "settled_by" UUID,
    "settled_note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payroll_advances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_advances_kind_check" CHECK ("kind" IN ('advance', 'loan')),
    CONSTRAINT "payroll_advances_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "payroll_advances_status_check" CHECK ("status" IN ('open', 'settled'))
);

-- An ended employment's final settlement, once HR marks it settled (open until then, and again once reopened).
CREATE TABLE "final_settlements" (
    "id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'settled',
    "settled_on" DATE NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "document_id" UUID,
    "settled_by" UUID,
    "settled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "final_settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "final_settlements_status_check" CHECK ("status" IN ('settled', 'open')),
    CONSTRAINT "final_settlements_amount_check" CHECK ("amount_paid" >= 0)
);

-- A line held on an approved or paid run, recorded as paid out since: the day, how and a note.
CREATE TABLE "payroll_hold_releases" (
    "id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_hold_releases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_hold_releases_method_check" CHECK ("method" IN ('bank_transfer', 'cash', 'later_run'))
);

CREATE INDEX "payroll_adjustments_month_idx" ON "payroll_adjustments"("month");
CREATE INDEX "payroll_adjustments_employee_id_idx" ON "payroll_adjustments"("employee_id");
CREATE INDEX "payroll_adjustments_advance_id_idx" ON "payroll_adjustments"("advance_id");
CREATE INDEX "payroll_adjustments_line_id_idx" ON "payroll_adjustments"("line_id");
CREATE INDEX "payroll_advances_employee_id_idx" ON "payroll_advances"("employee_id");
CREATE INDEX "payroll_advances_status_idx" ON "payroll_advances"("status");
CREATE UNIQUE INDEX "final_settlements_employment_id_key" ON "final_settlements"("employment_id");
CREATE INDEX "final_settlements_document_id_idx" ON "final_settlements"("document_id");
CREATE UNIQUE INDEX "payroll_hold_releases_line_id_key" ON "payroll_hold_releases"("line_id");

ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "payroll_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "payroll_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_advances" ADD CONSTRAINT "payroll_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_advances" ADD CONSTRAINT "payroll_advances_settled_by_fkey" FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_advances" ADD CONSTRAINT "payroll_advances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "generated_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_settled_by_fkey" FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_hold_releases" ADD CONSTRAINT "payroll_hold_releases_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "payroll_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_hold_releases" ADD CONSTRAINT "payroll_hold_releases_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
