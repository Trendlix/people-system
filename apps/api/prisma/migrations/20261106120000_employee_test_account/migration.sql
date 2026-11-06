-- Test accounts (owner, 6 November 2026: an account for Google's and Apple's app reviewers, "without real data"): kept
-- out of payroll runs, lists, counts and reports, and their requests tell nobody.
ALTER TABLE "employees" ADD COLUMN "test_account" BOOLEAN NOT NULL DEFAULT false;
