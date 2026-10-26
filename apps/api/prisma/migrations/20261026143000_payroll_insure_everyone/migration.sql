-- Social insurance for everyone, registered or not (owner, 26 October 2026: "when calculating the payroll for now,
-- calculate as if the employee is insured, no matter he is registered or not"): on to start with, the existing settings
-- row too.
ALTER TABLE "payroll_settings" ADD COLUMN "insure_everyone" BOOLEAN NOT NULL DEFAULT true;
