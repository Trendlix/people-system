-- Payroll: the run's grid columns moved to Additions / Deductions (owner, 17 October 2026, pointing at the inputs grid's
-- Penalty Days, Bonus Days, Commission and Settlements columns: "instead of there, i think earnings and deductions will
-- be enough"; he chose "Yes, as proposed"). Two types are entered in days, the month's run working the amount out from
-- the person's pay: a Bonus (days), an addition, taxed (a day of the fixed part); a Penalty (days), a deduction after
-- tax (a day of the contract's net). They keep their days and no amount until the CEO's approval applies them, when
-- the amount the line paid is copied in. A Correction is now a deduction too (a negative settlement). The typed grid
-- figures of draft runs are made pending items by the API when it starts (apps/api grid-inputs.service.ts), as the
-- lines are worked out again in TypeScript; approved and paid runs keep their figures. Nothing that is there changes.
-- Written to run again harmlessly (the column only if missing, each check dropped if there and made anew): an earlier
-- copy of it, under 20261017130000, ran on the test database before it was given its place after the raise requests'.

ALTER TABLE "payroll_adjustments" ADD COLUMN IF NOT EXISTS "days" DECIMAL(3,1);
ALTER TABLE "payroll_adjustments" ALTER COLUMN "amount" DROP NOT NULL;

-- the types of each kind: a Bonus (days) is taxed, as a bonus is; every deduction is after tax
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT IF EXISTS "payroll_adjustments_type_check";
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_type_check" CHECK (
    ("kind" = 'addition' AND "type" IN ('bonus', 'bonus_days', 'commission', 'incentive', 'correction', 'reimbursement', 'other') AND ("type" <> 'bonus_days' OR "taxed"))
    OR ("kind" = 'deduction' AND "type" IN ('penalty', 'penalty_days', 'correction', 'damage_loss', 'advance_recovery', 'loan_installment', 'other') AND NOT "taxed")
);

-- an amount of more than 0, or for one in days its days (whole or half, up to 31) and, once applied, what it came to
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT IF EXISTS "payroll_adjustments_amount_check";
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_amount_check" CHECK (
    CASE WHEN "type" IN ('bonus_days', 'penalty_days')
        THEN "days" IS NOT NULL AND "days" > 0 AND "days" <= 31 AND "days" * 2 = trunc("days" * 2)
            AND ("amount" IS NULL OR "amount" >= 0) AND ("status" <> 'applied' OR "amount" IS NOT NULL)
        ELSE "days" IS NULL AND "amount" IS NOT NULL AND "amount" > 0
    END
);
