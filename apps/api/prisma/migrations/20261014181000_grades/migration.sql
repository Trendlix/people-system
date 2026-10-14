-- The grading system (owner's table, 14 October 2026): G1 Entry Level … G9 Executive, ordered by rank.
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "level_en" TEXT NOT NULL,
    "level_ar" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "grades_code_key" ON "grades"("code");
CREATE UNIQUE INDEX "grades_rank_key" ON "grades"("rank");

INSERT INTO "grades" ("id", "code", "rank", "level_en", "description", "updated_at") VALUES
  (gen_random_uuid(), 'G1', 1, 'Entry Level', 'e.g. Intern / Trainee', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G2', 2, 'Junior', 'e.g. Junior Graphic Designer', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G3', 3, 'Intermediate', 'e.g. Graphic Designer', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G4', 4, 'Senior', 'e.g. Senior Graphic Designer', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G5', 5, 'Team Lead', 'e.g. Creative Team Lead', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G6', 6, 'Manager', 'e.g. Creative Manager', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G7', 7, 'Head of Department', 'e.g. Head of Creative', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G8', 8, 'Director', 'e.g. Operations Director', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G9', 9, 'Executive', 'e.g. CEO / Managing Director', CURRENT_TIMESTAMP);

-- Job titles point to a grade instead of holding free text. A grade typed as one of the codes ("g4", " G4 ") is kept;
-- anything else is cleared, to be chosen again from the list.
ALTER TABLE "job_titles" ADD COLUMN "grade_id" UUID;
UPDATE "job_titles" j SET "grade_id" = g."id" FROM "grades" g WHERE upper(trim(j."grade")) = g."code";
ALTER TABLE "job_titles" DROP COLUMN "grade";
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
