-- Salary review due after (owner's decision, 16 October 2026: the salary raises tracked both on each profile's Salary
-- History and in a company-wide Salary Raises report). The report lists who is due for a salary review: current
-- employees whose last raise, or their join date when they have had none, is at least this many months ago. A whole
-- number of months from 1 to 60: 12 to start with, a year without a raise. HR and Admin change it in Payroll Setup →
-- Your Rules.
ALTER TABLE "payroll_settings" ADD COLUMN "salary_review_months" INTEGER NOT NULL DEFAULT 12,
  ADD CONSTRAINT "payroll_settings_salary_review_months_check" CHECK ("salary_review_months" BETWEEN 1 AND 60);
