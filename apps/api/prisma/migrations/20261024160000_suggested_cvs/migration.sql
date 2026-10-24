-- Suggested From Earlier CVs on each open vacancy (owner, 24 October 2026: "does the system automatically add recomended
-- general cv's to the opened posts?" and "is there a run to fetch previously updated CV's?"; asked, "Suggest; HR adds",
-- "General CVs + past applicants", "Yes, HR presses 'Invite to apply'"; packages/shared suggested-cvs.ts). Written by
-- hand.

-- 1. A suggestion: one a candidate a vacancy, from their best earlier CV (a general CV, or an application to another
--    job), its score (0 to 100) and reasons as worked out last; suggested, invited (the address and when), added (the
--    application made), applied (on the vacancy otherwise) or dismissed (an optional reason), with who decided and when;
--    when HR was told of it. A vacancy's or a candidate's go with it; the earlier CV, the application and the account
--    gone leave the decision.
CREATE TABLE "vacancy_suggestions" (
    "id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "source_kind" TEXT NOT NULL,
    "general_cv_id" UUID,
    "source_application_id" UUID,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "invited_at" TIMESTAMPTZ,
    "invited_to" TEXT,
    "dismiss_reason" TEXT,
    "application_id" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "notified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vacancy_suggestions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vacancy_suggestions_source_kind_check" CHECK ("source_kind" IN ('general_cv', 'application')),
    CONSTRAINT "vacancy_suggestions_status_check" CHECK ("status" IN ('suggested', 'invited', 'added', 'applied', 'dismissed')),
    CONSTRAINT "vacancy_suggestions_score_check" CHECK ("score" BETWEEN 0 AND 100),
    CONSTRAINT "vacancy_suggestions_reasons_check" CHECK (jsonb_typeof("reasons") = 'array'),
    CONSTRAINT "vacancy_suggestions_invited_check" CHECK ("status" <> 'invited' OR ("invited_at" IS NOT NULL AND "invited_to" IS NOT NULL)),
    CONSTRAINT "vacancy_suggestions_reason_check" CHECK ("dismiss_reason" IS NULL OR char_length("dismiss_reason") <= 500)
);

CREATE UNIQUE INDEX "vacancy_suggestions_vacancy_id_candidate_id_key" ON "vacancy_suggestions"("vacancy_id", "candidate_id");
CREATE INDEX "vacancy_suggestions_vacancy_id_status_idx" ON "vacancy_suggestions"("vacancy_id", "status");
CREATE INDEX "vacancy_suggestions_candidate_id_idx" ON "vacancy_suggestions"("candidate_id");
CREATE INDEX "vacancy_suggestions_general_cv_id_idx" ON "vacancy_suggestions"("general_cv_id");
CREATE INDEX "vacancy_suggestions_source_application_id_idx" ON "vacancy_suggestions"("source_application_id");
CREATE INDEX "vacancy_suggestions_application_id_idx" ON "vacancy_suggestions"("application_id");

ALTER TABLE "vacancy_suggestions" ADD CONSTRAINT "vacancy_suggestions_vacancy_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vacancy_suggestions" ADD CONSTRAINT "vacancy_suggestions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vacancy_suggestions" ADD CONSTRAINT "vacancy_suggestions_general_cv_id_fkey" FOREIGN KEY ("general_cv_id") REFERENCES "general_cvs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vacancy_suggestions" ADD CONSTRAINT "vacancy_suggestions_source_application_id_fkey" FOREIGN KEY ("source_application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vacancy_suggestions" ADD CONSTRAINT "vacancy_suggestions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vacancy_suggestions" ADD CONSTRAINT "vacancy_suggestions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Recruitment Settings: how far back CVs count (1 to 36 months, 12 unless changed), and the invitation to apply's
--    subject and words (none: the standard).
ALTER TABLE "recruitment_settings" ADD COLUMN "suggest_months" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN "invite_subject" TEXT,
ADD COLUMN "invite_en" TEXT,
ADD COLUMN "invite_ar" TEXT;

ALTER TABLE "recruitment_settings" ADD CONSTRAINT "recruitment_settings_suggest_months_check" CHECK ("suggest_months" BETWEEN 1 AND 36);

-- 3. The applications' sources: those HR added from the suggestions (a general CV, an earlier applicant), and an
--    invitation's link (?src=invite), with every source before them.
ALTER TABLE "job_applications" DROP CONSTRAINT "job_applications_source_check";
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_source_check" CHECK ("source" IN (
    'careers', 'linkedin', 'facebook', 'job_board', 'referral', 'other', 'general',
    'general_suggested', 'earlier_applicant', 'invite'
));

-- 4. The notice (packages/shared notifications.ts): HR told once a batch that earlier CVs match an open vacancy. Every
--    kind of 20261024150000_notification_kinds_restated, then this one.
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
    'interview_scheduled', 'interview_feedback', 'hiring_suggestion', 'onboarding_items',
    'access_hold', 'access_grace', 'access_grace_ending', 'access_held',
    'od_waiting', 'od_decided',
    'access_no_contract',
    'meeting_connection',
    'screening_mention',
    'check_in_location_ending',
    'cv_suggestions'
));
