-- a Bonus (days) or a Penalty (days): more than 0 and up to 31, to the hundredth (a compensatory day's hours' pay; the
-- forms still take whole or half days), as before otherwise
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT IF EXISTS "payroll_adjustments_amount_check";
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_amount_check" CHECK (
    CASE WHEN "type" IN ('bonus_days', 'penalty_days')
        THEN "days" IS NOT NULL AND "days" > 0 AND "days" <= 31 AND "days" * 100 = trunc("days" * 100)
            AND ("amount" IS NULL OR "amount" >= 0) AND ("status" <> 'applied' OR "amount" IS NOT NULL)
        ELSE "days" IS NULL AND "amount" IS NOT NULL AND "amount" > 0
    END
);
