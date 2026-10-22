-- Recruitment, the ATS, Phase 2 (owner, 22 October 2026: "where will we include the ATS?"; accepted: "interview invites
-- go by email through the owner's SMTP settings"; packages/shared recruitment-hiring.ts and onboarding.ts; the module:
-- apps/api/src/recruitment).
--
-- 1. interviews: scheduled from an applicant (when, how long, in person, online or by phone, where, a note to the
--    candidate), each change counted (sequence: the calendar invitation's SEQUENCE); its interviewers (current
--    employees; when each was reminded of their scorecard) and their scorecards (four ratings from 1 to 5, a
--    recommendation, notes), one each.
-- 2. job_applications: the hiring manager's suggestion (the next step or a rejection), until HR acts on it.
-- 3. recruitment_settings: the rejection email's words as HR set them (none: the standard).
-- 4. onboarding: HR's default items, a checklist per employment (opened on a hire through an accepted job offer, or by
--    HR) and its items, offboarding's mirror.
-- 5. Four notification kinds: an interview for its interviewers, the scorecard reminder, the hiring manager's suggestion
--    for HR, the onboarding items. Every kind so far is kept.

-- 1.
CREATE TABLE "interviews" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "location" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "emailed_at" TIMESTAMPTZ,
    "email_problem" TEXT,
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ,
    "outcome_at" TIMESTAMPTZ,
    "outcome_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interviews_minutes_check" CHECK ("minutes" BETWEEN 15 AND 480),
    CONSTRAINT "interviews_kind_check" CHECK ("kind" IN ('in_person', 'online', 'phone')),
    CONSTRAINT "interviews_status_check" CHECK ("status" IN ('scheduled', 'done', 'no_show', 'cancelled')),
    CONSTRAINT "interviews_sequence_check" CHECK ("sequence" >= 0),
    CONSTRAINT "interviews_location_check" CHECK ("location" IS NULL OR length("location") <= 300),
    CONSTRAINT "interviews_note_check" CHECK ("note" IS NULL OR length("note") <= 1000)
);

CREATE INDEX "interviews_application_id_idx" ON "interviews"("application_id");
CREATE INDEX "interviews_status_starts_at_idx" ON "interviews"("status", "starts_at");

ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_outcome_by_fkey" FOREIGN KEY ("outcome_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "interview_interviewers" (
    "interview_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reminded_at" TIMESTAMPTZ,

    CONSTRAINT "interview_interviewers_pkey" PRIMARY KEY ("interview_id", "employee_id")
);

CREATE INDEX "interview_interviewers_employee_id_idx" ON "interview_interviewers"("employee_id");

ALTER TABLE "interview_interviewers" ADD CONSTRAINT "interview_interviewers_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_interviewers" ADD CONSTRAINT "interview_interviewers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "interview_feedback" (
    "id" UUID NOT NULL,
    "interview_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "rating_skills" INTEGER NOT NULL,
    "rating_experience" INTEGER NOT NULL,
    "rating_communication" INTEGER NOT NULL,
    "rating_culture" INTEGER NOT NULL,
    "recommendation" TEXT NOT NULL,
    "notes" TEXT,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "interview_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interview_feedback_ratings_check" CHECK (
        "rating_skills" BETWEEN 1 AND 5 AND "rating_experience" BETWEEN 1 AND 5 AND "rating_communication" BETWEEN 1 AND 5 AND "rating_culture" BETWEEN 1 AND 5
    ),
    CONSTRAINT "interview_feedback_recommendation_check" CHECK ("recommendation" IN ('strong_yes', 'yes', 'no', 'strong_no')),
    CONSTRAINT "interview_feedback_notes_check" CHECK ("notes" IS NULL OR length("notes") <= 2000)
);

CREATE UNIQUE INDEX "interview_feedback_interview_id_employee_id_key" ON "interview_feedback"("interview_id", "employee_id");

ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2.
ALTER TABLE "job_applications" ADD COLUMN "suggestion" TEXT,
ADD COLUMN "suggestion_note" TEXT,
ADD COLUMN "suggested_by" UUID,
ADD COLUMN "suggested_at" TIMESTAMPTZ;

ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_suggestion_check" CHECK ("suggestion" IS NULL OR "suggestion" IN ('next', 'reject'));
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_suggested_by_fkey" FOREIGN KEY ("suggested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3.
CREATE TABLE "recruitment_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rejection_subject" TEXT,
    "rejection_en" TEXT,
    "rejection_ar" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recruitment_settings_id_check" CHECK ("id" = 1)
);

ALTER TABLE "recruitment_settings" ADD CONSTRAINT "recruitment_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4.
CREATE TABLE "onboarding_defaults" (
    "id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "onboarding_defaults_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_defaults_owner_check" CHECK ("owner" IN ('hr', 'manager', 'admin', 'finance', 'assets')),
    CONSTRAINT "onboarding_defaults_label_check" CHECK (length(btrim("label")) BETWEEN 1 AND 120)
);

CREATE INDEX "onboarding_defaults_active_position_idx" ON "onboarding_defaults"("active", "position");

ALTER TABLE "onboarding_defaults" ADD CONSTRAINT "onboarding_defaults_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "onboarding_defaults" ("id", "position", "label", "owner", "updated_at") VALUES
    (gen_random_uuid(), 1, 'National ID and documents collected', 'hr', now()),
    (gen_random_uuid(), 2, 'JD sign-off', 'manager', now()),
    (gen_random_uuid(), 3, 'Accounts created', 'admin', now()),
    (gen_random_uuid(), 4, 'Social insurance Form 1', 'hr', now());

CREATE TABLE "onboarding_checklists" (
    "id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "application_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "opened_by" UUID,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "onboarding_checklists_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_checklists_status_check" CHECK ("status" IN ('open', 'completed'))
);

CREATE UNIQUE INDEX "onboarding_checklists_employment_id_key" ON "onboarding_checklists"("employment_id");
CREATE INDEX "onboarding_checklists_status_idx" ON "onboarding_checklists"("status");

ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "onboarding_items" (
    "id" UUID NOT NULL,
    "checklist_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "label" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "done_by" UUID,
    "done_at" TIMESTAMPTZ,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "onboarding_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_items_kind_check" CHECK ("kind" IN ('manual', 'contract', 'kpi_template', 'assets')),
    CONSTRAINT "onboarding_items_owner_check" CHECK ("owner" IN ('hr', 'manager', 'admin', 'finance', 'assets')),
    CONSTRAINT "onboarding_items_status_check" CHECK ("status" IN ('pending', 'done', 'not_applicable')),
    CONSTRAINT "onboarding_items_label_check" CHECK (length(btrim("label")) BETWEEN 1 AND 120),
    CONSTRAINT "onboarding_items_note_check" CHECK ("note" IS NULL OR length("note") <= 500)
);

CREATE UNIQUE INDEX "onboarding_items_checklist_id_position_key" ON "onboarding_items"("checklist_id", "position");

ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "onboarding_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5.
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
    'vacancy_waiting', 'vacancy_decided', 'applications_new',
    'interview_scheduled', 'interview_feedback', 'hiring_suggestion', 'onboarding_items'
));
