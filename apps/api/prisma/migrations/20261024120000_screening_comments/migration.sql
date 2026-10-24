-- Screening comments with a verdict (owner, 24 October 2026, on a candidate's profile: "when opening a CV, open it in a
-- popup window", "is there a way to add screening comments?", "and i can add genearrl comments"; asked, the verdict
-- "Yes: Good fit / Maybe / Not a fit" and who "HR + hiring manager & interviewers"; packages/shared screening.ts).
-- Written by hand.

-- 1. A comment: always about a candidate; about one of their applications or general CVs, or (neither) about the person
--    in general. Its author (none: HR's earlier notes, named by author_label, or an account since removed) and their role
--    when they wrote it; the text (at most 2,000 characters); an optional verdict; the colleagues mentioned (their
--    accounts' ids, told when mentioned); when written and last edited. `from_notes`: HR's single notes box of before,
--    moved into the record's first comment once (the API's pass, apps/api/src/recruitment/screening-notes.ts), at most
--    one a record (the unique indexes below keep the pass idempotent).
CREATE TABLE "screening_comments" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "application_id" UUID,
    "general_cv_id" UUID,
    "author_id" UUID,
    "author_label" TEXT,
    "author_role" TEXT,
    "text" TEXT NOT NULL,
    "verdict" TEXT,
    "mentions" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "from_notes" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ,

    CONSTRAINT "screening_comments_pkey" PRIMARY KEY ("id"),
    -- one record at most: an application, a general CV, or neither (a general comment)
    CONSTRAINT "screening_comments_about_check" CHECK ("application_id" IS NULL OR "general_cv_id" IS NULL),
    CONSTRAINT "screening_comments_verdict_check" CHECK ("verdict" IS NULL OR "verdict" IN ('good_fit', 'maybe', 'not_a_fit')),
    CONSTRAINT "screening_comments_role_check" CHECK ("author_role" IS NULL OR "author_role" IN ('hr', 'ceo', 'super_admin', 'hiring_manager', 'interviewer')),
    CONSTRAINT "screening_comments_text_check" CHECK (char_length(btrim("text")) BETWEEN 1 AND 2000),
    -- the earlier notes: a record's, without an author or a verdict
    CONSTRAINT "screening_comments_notes_check" CHECK (NOT "from_notes" OR ("author_id" IS NULL AND "verdict" IS NULL AND ("application_id" IS NOT NULL OR "general_cv_id" IS NOT NULL)))
);

CREATE INDEX "screening_comments_candidate_id_created_at_idx" ON "screening_comments"("candidate_id", "created_at");
CREATE INDEX "screening_comments_application_id_created_at_idx" ON "screening_comments"("application_id", "created_at");
CREATE INDEX "screening_comments_general_cv_id_created_at_idx" ON "screening_comments"("general_cv_id", "created_at");
CREATE INDEX "screening_comments_author_id_idx" ON "screening_comments"("author_id");
CREATE UNIQUE INDEX "screening_comments_notes_application" ON "screening_comments"("application_id") WHERE "from_notes";
CREATE UNIQUE INDEX "screening_comments_notes_general_cv" ON "screening_comments"("general_cv_id") WHERE "from_notes";

-- a candidate's, an application's or a general CV's comments go with it; an author's account removed leaves the comment
ALTER TABLE "screening_comments" ADD CONSTRAINT "screening_comments_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "screening_comments" ADD CONSTRAINT "screening_comments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "screening_comments" ADD CONSTRAINT "screening_comments_general_cv_id_fkey" FOREIGN KEY ("general_cv_id") REFERENCES "general_cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "screening_comments" ADD CONSTRAINT "screening_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. A Word CV converted to PDF for the CV window, kept (the converter is slow): one an application's CV or a general
--    CV's file, with the SHA-256 of the Word file it was made from (made again when that differs). Gone with the CV.
CREATE TABLE "cv_previews" (
    "id" UUID NOT NULL,
    "application_id" UUID,
    "general_cv_id" UUID,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cv_previews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cv_previews_one_check" CHECK (("application_id" IS NULL) <> ("general_cv_id" IS NULL))
);

CREATE UNIQUE INDEX "cv_previews_application_id_key" ON "cv_previews"("application_id");
CREATE UNIQUE INDEX "cv_previews_general_cv_id_key" ON "cv_previews"("general_cv_id");

ALTER TABLE "cv_previews" ADD CONSTRAINT "cv_previews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_application_cvs"("application_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cv_previews" ADD CONSTRAINT "cv_previews_general_cv_id_fkey" FOREIGN KEY ("general_cv_id") REFERENCES "general_cv_files"("general_cv_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. The notice (packages/shared notifications.ts): a colleague @mentioned in a screening comment they may read. Every
--    kind kept: those of 20261024110000_meeting_providers, then this one.
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
    'screening_mention'
));
