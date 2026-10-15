-- Job title and grade apart (owner's decision, 15 October 2026): a job title takes a range of grades (the lowest and
-- the highest, either or both optional), and each employment has the person's own grade, within that range. A Junior and
-- a Senior Account Manager are both Account Managers, at different grades.

-- 1. A job title's grade becomes both ends of its range: a title that had G4 now takes "G4 to G4", for HR to widen.
ALTER TABLE "job_titles" ADD COLUMN "min_grade_id" UUID, ADD COLUMN "max_grade_id" UUID;
UPDATE "job_titles" SET "min_grade_id" = "grade_id", "max_grade_id" = "grade_id" WHERE "grade_id" IS NOT NULL;

-- 2. Each employment gets the grade of its job title, so everyone keeps the grade they effectively had, ended
-- employments included.
ALTER TABLE "employments" ADD COLUMN "grade_id" UUID;
UPDATE "employments" e SET "grade_id" = j."grade_id" FROM "job_titles" j WHERE e."job_title_id" = j."id" AND j."grade_id" IS NOT NULL;

-- 3. Only after both copies: the job title's single grade goes.
ALTER TABLE "job_titles" DROP CONSTRAINT "job_titles_grade_id_fkey";
ALTER TABLE "job_titles" DROP COLUMN "grade_id";

CREATE INDEX "employments_grade_id_idx" ON "employments"("grade_id");
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_min_grade_id_fkey" FOREIGN KEY ("min_grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_max_grade_id_fkey" FOREIGN KEY ("max_grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employments" ADD CONSTRAINT "employments_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
