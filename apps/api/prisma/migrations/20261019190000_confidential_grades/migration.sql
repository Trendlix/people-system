-- C-level people kept from HR (owner, 19 October 2026: "make C level Employees details not visible to HR"). Asked, the
-- owner chose: C-level is everyone whose grade is G9 · Executive, by a flag on the grade, so it follows the grade, not a
-- person (changing someone's grade changes it). HR, Finance, Admin and managers see only a C-level person's directory
-- card; the CEO and the Super Admin see and manage everything. A Super Admin ticks a grade confidential on the grades
-- page. The rules: packages/shared confidential.ts.
--
-- 1. The flag: no grade is confidential unless marked.
-- 2. G9 · Executive (rank 9 in the owner's table, 14 October 2026) is marked: by its code, else by its rank.
-- A data fix, not audited, as in the migrations before.

-- 1.
ALTER TABLE "grades" ADD COLUMN "confidential" BOOLEAN NOT NULL DEFAULT false;

-- 2.
UPDATE "grades" SET "confidential" = true WHERE "code" = 'G9' OR ("rank" = 9 AND NOT EXISTS (SELECT 1 FROM "grades" WHERE "code" = 'G9'));
