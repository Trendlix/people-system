-- General CVs, the applicants by posted job, and the bulk upload of CVs (owner, 22 October 2026: "i want a proper
-- viweing, what came out of the posted jobs and what cam on randomly", "Both"; "is there a way to easy apply from
-- linkedin?" … "why not"; packages/shared general-cvs.ts).
--
-- 1. General CVs: people who sent a CV without applying for a posted vacancy ("Send us your CV" on the careers page) or
--    whose CV HR added (email, WhatsApp, LinkedIn, in person, referral, other): their details, the area they would like
--    to work in (a department, or Other in words), where it came from, the consent (theirs on the careers page, or HR's
--    with who and when), a reference in the applications' series (APP-2026-0007); new, reviewed, moved to a vacancy (the
--    application made from it), archived. Their CV apart (as an application's), and what happened to them in order.
-- 2. Applications: a general CV moved to a vacancy is a source of its own ('general'), and the consent HR records for a
--    CV they add (a bulk upload, a general CV moved) says who and why.
-- 3. The bulk upload's CVs waiting for HR to check their rows: each with what its text told (the name, email, mobile),
--    for a vacancy or for the general CVs; the person's own, gone once saved or discarded (or after a day).

-- 1.
CREATE TABLE "general_cvs" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "linkedin" TEXT,
    "portfolio" TEXT,
    "years_experience" DECIMAL(4,1),
    "notice_period" TEXT,
    "expected_salary" DECIMAL(12,2),
    "department_id" UUID,
    "area_other" TEXT,
    "source" TEXT NOT NULL,
    "referrer" TEXT,
    "notes" TEXT,
    "consent_at" TIMESTAMPTZ NOT NULL,
    "consent_by" UUID,
    "consent_note" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "application_id" UUID,
    "moved_at" TIMESTAMPTZ,

    CONSTRAINT "general_cvs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "general_cvs_number_check" CHECK ("number" ~ '^APP-[0-9]{4}-[0-9]{4,}$'),
    CONSTRAINT "general_cvs_status_check" CHECK ("status" IN ('new', 'reviewed', 'moved', 'archived')),
    CONSTRAINT "general_cvs_source_check" CHECK ("source" IN ('careers', 'email', 'whatsapp', 'linkedin', 'walk_in', 'referral', 'other')),
    CONSTRAINT "general_cvs_email_check" CHECK ("email" = lower(btrim("email")) AND "email" LIKE '%@%'),
    CONSTRAINT "general_cvs_area_check" CHECK ("department_id" IS NOT NULL OR "area_other" IS NOT NULL),
    CONSTRAINT "general_cvs_years_check" CHECK ("years_experience" IS NULL OR "years_experience" BETWEEN 0 AND 60),
    CONSTRAINT "general_cvs_expected_salary_check" CHECK ("expected_salary" IS NULL OR "expected_salary" >= 0),
    -- moved: when (the application may be gone since, a Super Admin's deletion)
    CONSTRAINT "general_cvs_moved_check" CHECK ("status" <> 'moved' OR "moved_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "general_cvs_number_key" ON "general_cvs"("number");
CREATE UNIQUE INDEX "general_cvs_application_id_key" ON "general_cvs"("application_id");
CREATE INDEX "general_cvs_email_created_at_idx" ON "general_cvs"("email", "created_at");
CREATE INDEX "general_cvs_status_idx" ON "general_cvs"("status");
CREATE INDEX "general_cvs_ip_created_at_idx" ON "general_cvs"("ip", "created_at");

ALTER TABLE "general_cvs" ADD CONSTRAINT "general_cvs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "general_cvs" ADD CONSTRAINT "general_cvs_consent_by_fkey" FOREIGN KEY ("consent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "general_cvs" ADD CONSTRAINT "general_cvs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "general_cvs" ADD CONSTRAINT "general_cvs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "general_cv_files" (
    "general_cv_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "general_cv_files_pkey" PRIMARY KEY ("general_cv_id"),
    CONSTRAINT "general_cv_files_type_check" CHECK (
        "mime_type" IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        AND "size_bytes" BETWEEN 1 AND 5242880
    )
);

ALTER TABLE "general_cv_files" ADD CONSTRAINT "general_cv_files_general_cv_id_fkey" FOREIGN KEY ("general_cv_id") REFERENCES "general_cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "general_cv_events" (
    "id" UUID NOT NULL,
    "general_cv_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "note" TEXT,
    "by_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "general_cv_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "general_cv_events_event_check" CHECK ("event" IN ('received', 'reviewed', 'archived', 'restored', 'moved'))
);

CREATE INDEX "general_cv_events_general_cv_id_at_idx" ON "general_cv_events"("general_cv_id", "at");

ALTER TABLE "general_cv_events" ADD CONSTRAINT "general_cv_events_general_cv_id_fkey" FOREIGN KEY ("general_cv_id") REFERENCES "general_cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "general_cv_events" ADD CONSTRAINT "general_cv_events_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2.
ALTER TABLE "job_applications" DROP CONSTRAINT "job_applications_source_check";
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_source_check" CHECK ("source" IN ('careers', 'linkedin', 'facebook', 'job_board', 'referral', 'other', 'general'));

ALTER TABLE "job_applications" ADD COLUMN "consent_by" UUID,
ADD COLUMN "consent_note" TEXT;

ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_consent_by_fkey" FOREIGN KEY ("consent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3.
CREATE TABLE "cv_uploads" (
    "id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "vacancy_id" UUID,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "text_found" BOOLEAN NOT NULL DEFAULT false,
    "guess" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cv_uploads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cv_uploads_type_check" CHECK (
        "mime_type" IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        AND "size_bytes" BETWEEN 1 AND 5242880
    ),
    CONSTRAINT "cv_uploads_guess_check" CHECK (jsonb_typeof("guess") = 'object')
);

CREATE INDEX "cv_uploads_created_by_created_at_idx" ON "cv_uploads"("created_by", "created_at");

ALTER TABLE "cv_uploads" ADD CONSTRAINT "cv_uploads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cv_uploads" ADD CONSTRAINT "cv_uploads_vacancy_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
