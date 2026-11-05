-- Corrections of an approved (or paid) run's lines (owner, 5 November 2026: "if there was a problem in the employee
-- calculation and has been edited"; asked, "Payslip and register too"): the line worked out again with its inputs
-- changed, why, by whom, and the transfer before and after, which the bank batches pay the rest of.
CREATE TABLE "payroll_line_corrections" (
    "id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "net_from" DECIMAL(12,2) NOT NULL,
    "net_to" DECIMAL(12,2) NOT NULL,
    "transfer_from" DECIMAL(12,2) NOT NULL,
    "transfer_to" DECIMAL(12,2) NOT NULL,
    "by_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_line_corrections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_line_corrections_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 500)
);

CREATE INDEX "payroll_line_corrections_line_id_idx" ON "payroll_line_corrections"("line_id");

ALTER TABLE "payroll_line_corrections" ADD CONSTRAINT "payroll_line_corrections_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "payroll_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_line_corrections" ADD CONSTRAINT "payroll_line_corrections_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
