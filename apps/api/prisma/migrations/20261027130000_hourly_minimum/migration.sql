-- A minimum a month for pay by the hour (owner, 27 October 2026: "can i add rate per hour with a minimum monthly
-- payment?"; he chose "On each contract" and "Prorated by days"): on a contract or an offer paid by the hour, the least
-- paid a month. Payroll pays the hours worked × the rate, or the minimum for the days paid (the minimum × the days paid
-- ÷ the day divisor) if that is more. Null: no minimum, as before.
ALTER TABLE "contracts" ADD COLUMN "hourly_minimum" DECIMAL(12,2);
ALTER TABLE "job_offers" ADD COLUMN "hourly_minimum" DECIMAL(12,2);
