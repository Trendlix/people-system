-- Installments and recurring deductions (owner, 18 October 2026: "in the deductions i might have a loan of a medical
-- subscription or something that needs to be deducted as installments on the employee. how will it be managed?").
-- Decided with the owner the same day: an advance's or a loan's monthly installments are made at once from its plan (no
-- new column: they are its linked deductions, as before); a medical subscription is a recurring deduction, a fixed
-- amount a month added to each month's payroll as a Recurring deduction (a new deduction type, after tax like every
-- deduction) linked to it, once a month at most; leaving before it is paid back, what is left is "taken from the final
-- settlement, unless waived", so an advance says how it was settled; and Payroll Setup warns (never blocks) when a
-- month's installments pass a share of the pay, 10% to start with. Nothing that is there changes but the advances
-- already settled being told how: by HR (with HR's note, which is required) as paid back, else as recovered.

-- A recurring deduction: the employee, what it is for (up to 100 characters), the amount a month (more than 0), the
-- first month, the last month if any, and once stopped the first month no longer deducted, with why. Months are kept
-- as their first day.
CREATE TABLE "recurring_deductions" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "start_month" DATE NOT NULL,
    "end_month" DATE,
    "stopped_from" DATE,
    "stop_note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recurring_deductions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recurring_deductions_name_check" CHECK (btrim("name") <> '' AND char_length("name") <= 100),
    CONSTRAINT "recurring_deductions_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "recurring_deductions_months_check" CHECK (
        EXTRACT(DAY FROM "start_month") = 1
        AND ("end_month" IS NULL OR (EXTRACT(DAY FROM "end_month") = 1 AND "end_month" >= "start_month"))
        AND ("stopped_from" IS NULL OR (EXTRACT(DAY FROM "stopped_from") = 1 AND "stopped_from" >= "start_month"))
    )
);

CREATE INDEX "recurring_deductions_employee_id_idx" ON "recurring_deductions"("employee_id");

ALTER TABLE "recurring_deductions" ADD CONSTRAINT "recurring_deductions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_deductions" ADD CONSTRAINT "recurring_deductions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A month's Recurring deduction is linked to its recurring deduction, once a month (cancelled ones too, so a month HR
-- cancelled isn't added again); a deduction linked to one is a Recurring deduction.
ALTER TABLE "payroll_adjustments" ADD COLUMN "recurring_id" UUID;

CREATE UNIQUE INDEX "payroll_adjustments_recurring_id_month_key" ON "payroll_adjustments"("recurring_id", "month");

ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_recurring_id_fkey" FOREIGN KEY ("recurring_id") REFERENCES "recurring_deductions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- the types of each kind, a Recurring deduction among the deductions (all after tax)
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT IF EXISTS "payroll_adjustments_type_check";
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_type_check" CHECK (
    ("kind" = 'addition' AND "type" IN ('bonus', 'bonus_days', 'commission', 'incentive', 'correction', 'reimbursement', 'other') AND ("type" <> 'bonus_days' OR "taxed"))
    OR ("kind" = 'deduction' AND "type" IN ('penalty', 'penalty_days', 'correction', 'damage_loss', 'advance_recovery', 'loan_installment', 'recurring', 'other') AND NOT "taxed")
);
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_recurring_check" CHECK ("recurring_id" IS NULL OR ("kind" = 'deduction' AND "type" = 'recurring'));

-- How an advance or loan was settled: recovered by its deductions, deducted from the final settlement, waived, or paid
-- back; none while it is open. Those settled already: by HR (a note, which HR always gave) paid back, else recovered.
ALTER TABLE "payroll_advances" ADD COLUMN "settled_how" TEXT;

UPDATE "payroll_advances"
SET "settled_how" = CASE WHEN "settled_note" IS NULL THEN 'recovered' ELSE 'paid_back' END
WHERE "status" = 'settled';

ALTER TABLE "payroll_advances" ADD CONSTRAINT "payroll_advances_settled_how_check" CHECK (
    ("status" = 'open' AND "settled_how" IS NULL)
    OR ("status" = 'settled' AND "settled_how" IS NOT NULL AND "settled_how" IN ('recovered', 'final_settlement', 'waived', 'paid_back'))
);

-- Payroll Setup: warn when a month's installments pass this share of the pay, 1 to 100 percent, 10 to start with; none:
-- no warning
ALTER TABLE "payroll_settings" ADD COLUMN "installment_warn_percent" DECIMAL(5,2) DEFAULT 10;
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_installment_warn_percent_check" CHECK ("installment_warn_percent" IS NULL OR "installment_warn_percent" BETWEEN 1 AND 100);
