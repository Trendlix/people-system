-- Recruitment, the ATS, Phase 1 (owner, 22 October 2026: "where will we include the ATS?"; the original plan's spec §12;
-- packages/shared recruitment.ts; the module: apps/api/src/recruitment).
--
-- 1. vacancies: HR drafts them from a job title, the CEO approves them (pending → open) before they show on the careers
--    page (people.trendlix.com/careers); the internal salary range is HR's, the CEO's and a Super Admin's only.
-- 2. job_applications: the careers page's applications, one per email a vacancy, with the match worked out from the
--    vacancy's screening questions; job_application_cvs their CV (a PDF or a Word file, at most 5 MB); and
--    job_application_steps what happened to each, in order.
-- 3. job_offers.application_id: the application a job offer was made from (Make offer); its answer moves the
--    application on (accepted: hired; declined or withdrawn: back to shortlisted).
-- 4. Three notification kinds: a vacancy waiting for the CEO, the CEO's decision, and new applications (once a day a
--    vacancy). Every kind so far is kept.

-- AlterTable
ALTER TABLE "job_offers" ADD COLUMN     "application_id" UUID;

-- CreateTable
CREATE TABLE "vacancies" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "job_title_id" UUID NOT NULL,
    "department_id" UUID,
    "grade_id" UUID,
    "hiring_manager_id" UUID,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "employment_type" "employment_type" NOT NULL,
    "work_arrangement" "work_arrangement" NOT NULL DEFAULT 'office',
    "shift_id" UUID,
    "duration_months" INTEGER,
    "closing_date" DATE,
    "salary_min" DECIMAL(12,2),
    "salary_max" DECIMAL(12,2),
    "about" TEXT,
    "responsibilities" TEXT,
    "requirements" TEXT,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "submitted_at" TIMESTAMPTZ,
    "submitted_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decided_by" UUID,
    "sent_back_reason" TEXT,
    "published_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "closed_by" UUID,
    "close_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'applied',
    "rejected_from" TEXT,
    "filtered_out" BOOLEAN NOT NULL DEFAULT false,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "linkedin" TEXT,
    "portfolio" TEXT,
    "years_experience" DECIMAL(4,1),
    "notice_period" TEXT,
    "expected_salary" DECIMAL(12,2),
    "answers" JSONB NOT NULL DEFAULT '{}',
    "points" INTEGER NOT NULL DEFAULT 0,
    "max_points" INTEGER NOT NULL DEFAULT 0,
    "match_percent" INTEGER,
    "knocked_out" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'careers',
    "consent_at" TIMESTAMPTZ NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "notes" TEXT,
    "reject_reason" TEXT,
    "employee_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_application_cvs" (
    "application_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_application_cvs_pkey" PRIMARY KEY ("application_id")
);

-- CreateTable
CREATE TABLE "job_application_steps" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "note" TEXT,
    "by_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_application_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vacancies_number_key" ON "vacancies"("number");

-- CreateIndex
CREATE UNIQUE INDEX "vacancies_slug_key" ON "vacancies"("slug");

-- CreateIndex
CREATE INDEX "vacancies_status_idx" ON "vacancies"("status");

-- CreateIndex
CREATE INDEX "vacancies_job_title_id_idx" ON "vacancies"("job_title_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_number_key" ON "job_applications"("number");

-- CreateIndex
CREATE INDEX "job_applications_stage_idx" ON "job_applications"("stage");

-- CreateIndex
CREATE INDEX "job_applications_ip_created_at_idx" ON "job_applications"("ip", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_vacancy_id_email_key" ON "job_applications"("vacancy_id", "email");

-- CreateIndex
CREATE INDEX "job_application_steps_application_id_at_idx" ON "job_application_steps"("application_id", "at");

-- CreateIndex
CREATE INDEX "job_offers_application_id_idx" ON "job_offers"("application_id");

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_hiring_manager_id_fkey" FOREIGN KEY ("hiring_manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_vacancy_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_cvs" ADD CONSTRAINT "job_application_cvs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_steps" ADD CONSTRAINT "job_application_steps_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_steps" ADD CONSTRAINT "job_application_steps_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 1. what a vacancy holds
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_number_check" CHECK ("number" ~ '^VAC-[0-9]{4}-[0-9]{4,}$');
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 90);
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_status_check" CHECK ("status" IN ('draft', 'pending', 'open', 'on_hold', 'closed', 'filled'));
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_headcount_check" CHECK ("headcount" BETWEEN 1 AND 50);
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_duration_months_check" CHECK ("duration_months" IS NULL OR "duration_months" BETWEEN 1 AND 60);
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_salary_check" CHECK (
    ("salary_min" IS NULL OR "salary_min" >= 0) AND ("salary_max" IS NULL OR "salary_max" >= 0)
    AND ("salary_min" IS NULL OR "salary_max" IS NULL OR "salary_min" <= "salary_max")
);
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_questions_check" CHECK (jsonb_typeof("questions") = 'array' AND jsonb_array_length("questions") <= 10);
-- published once approved
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_published_check" CHECK ("status" IN ('draft', 'pending') OR "published_at" IS NOT NULL);

-- 2. what an application holds
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_number_check" CHECK ("number" ~ '^APP-[0-9]{4}-[0-9]{4,}$');
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_stage_check" CHECK ("stage" IN ('applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'));
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_rejected_from_check" CHECK (
    ("stage" = 'rejected') = ("rejected_from" IS NOT NULL)
    AND ("rejected_from" IS NULL OR "rejected_from" IN ('applied', 'shortlisted', 'interview', 'offer'))
);
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_source_check" CHECK ("source" IN ('careers', 'linkedin', 'facebook', 'job_board', 'referral', 'other'));
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_email_check" CHECK ("email" = lower(btrim("email")) AND "email" LIKE '%@%');
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_match_check" CHECK (
    "points" >= 0 AND "max_points" >= 0 AND "points" <= "max_points"
    AND ("match_percent" IS NULL OR "match_percent" BETWEEN 0 AND 100)
);
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_answers_check" CHECK (jsonb_typeof("answers") = 'object');
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_years_check" CHECK ("years_experience" IS NULL OR "years_experience" BETWEEN 0 AND 60);
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_expected_salary_check" CHECK ("expected_salary" IS NULL OR "expected_salary" >= 0);
ALTER TABLE "job_application_cvs" ADD CONSTRAINT "job_application_cvs_type_check" CHECK (
    "mime_type" IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    AND "size_bytes" BETWEEN 1 AND 5242880
);
ALTER TABLE "job_application_steps" ADD CONSTRAINT "job_application_steps_event_check" CHECK ("event" IN (
    'applied', 'filtered_out', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'restored', 'offer_declined', 'offer_withdrawn'
));
ALTER TABLE "job_application_steps" ADD CONSTRAINT "job_application_steps_stage_check" CHECK ("stage" IN ('applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'));

-- 4.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN (
    'leave_waiting', 'leave_decided', 'permission_waiting', 'permission_decided',
    'reimbursement_waiting', 'reimbursement_decided', 'reimbursement_paid',
    'correction_waiting', 'correction_decided',
    'raise_request_waiting', 'pay_raise_waiting', 'pay_raise_decided',
    'payslip_issued', 'home_location_waiting', 'home_location_decided',
    'check_in_reminder', 'check_out_reminder',
    'kpi_self_rating', 'kpi_waiting', 'kpi_ready_to_sign',
    'wfh_waiting', 'wfh_decided',
    'custody_handover', 'custody_return', 'custody_overdue', 'custody_unsigned',
    'offboarding_items', 'offboarding_cleared', 'exit_interview',
    'vacancy_waiting', 'vacancy_decided', 'applications_new'
));
