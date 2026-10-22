-- CV reading and rule-based analysis (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it. is that
-- applicable?"; asked, "Built-in rules only"). Every CV is read in the background (the API's CvReadingsService): a
-- PDF's own text, else the OCR service for a scan, a Word file's paragraphs; simple rules then find its contacts, the
-- years of experience from its dates, the education level, the languages, and a vacancy's key skills (the CV match %).
--
-- 1. A CV's reading: one row for each CV, of an application, a general CV or a bulk upload's file (exactly one), deleted
--    with it. Every CV already here gets a pending one, so the reader reads them on its own.
-- 2. A vacancy's key skills (at most 20), and each application's CV match %.

-- 1.
CREATE TABLE "cv_readings" (
    "id" UUID NOT NULL,
    "application_id" UUID,
    "general_cv_id" UUID,
    "upload_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "method" TEXT,
    "text" TEXT,
    "facts" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_try_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cv_readings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cv_readings_one_cv_check" CHECK (num_nonnulls("application_id", "general_cv_id", "upload_id") = 1),
    CONSTRAINT "cv_readings_status_check" CHECK ("status" IN ('pending', 'read', 'no_text', 'failed')),
    CONSTRAINT "cv_readings_method_check" CHECK ("method" IS NULL OR "method" IN ('pdf', 'docx', 'ocr_en', 'ocr_ar')),
    CONSTRAINT "cv_readings_text_check" CHECK ("text" IS NULL OR length("text") <= 60000),
    CONSTRAINT "cv_readings_facts_check" CHECK ("facts" IS NULL OR jsonb_typeof("facts") = 'object'),
    CONSTRAINT "cv_readings_attempts_check" CHECK ("attempts" BETWEEN 0 AND 10)
);

CREATE UNIQUE INDEX "cv_readings_application_id_key" ON "cv_readings"("application_id");
CREATE UNIQUE INDEX "cv_readings_general_cv_id_key" ON "cv_readings"("general_cv_id");
CREATE UNIQUE INDEX "cv_readings_upload_id_key" ON "cv_readings"("upload_id");
CREATE INDEX "cv_readings_status_next_try_at_idx" ON "cv_readings"("status", "next_try_at");

ALTER TABLE "cv_readings" ADD CONSTRAINT "cv_readings_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cv_readings" ADD CONSTRAINT "cv_readings_general_cv_id_fkey" FOREIGN KEY ("general_cv_id") REFERENCES "general_cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cv_readings" ADD CONSTRAINT "cv_readings_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "cv_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- the CVs already here, to be read
INSERT INTO "cv_readings" ("id", "application_id") SELECT gen_random_uuid(), "application_id" FROM "job_application_cvs";
INSERT INTO "cv_readings" ("id", "general_cv_id") SELECT gen_random_uuid(), "general_cv_id" FROM "general_cv_files";

-- 2.
ALTER TABLE "vacancies" ADD COLUMN "key_skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_key_skills_check" CHECK (cardinality("key_skills") <= 20);

ALTER TABLE "job_applications" ADD COLUMN "cv_match_percent" INTEGER;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_cv_match_percent_check" CHECK ("cv_match_percent" IS NULL OR "cv_match_percent" BETWEEN 0 AND 100);
