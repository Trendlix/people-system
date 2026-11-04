-- The recruitment tree (owner, 3 November 2026: "Recrutment tree"; packages/shared recruitment-tree.ts): Applicants,
-- Review 1 (the vacancy's recruiter), Review 2 (the recruiter's manager), Final Review (the hiring manager), HR
-- Screening, Technical Interview, Offer; Shortlisted goes. The applicants at Shortlisted move "By progress": the hiring
-- manager accepted them (or the vacancy has none) and they passed the screening call: Technical Interview; accepted
-- only: HR Screening; rejected by the hiring manager: rejected at the Final Review (their rejection is final since);
-- not reviewed yet: Review 2. Each move is a step of their history. The decisions of before (the hiring manager's
-- review, a passed screening call) are kept as the tree's.

-- 1. The vacancy's recruiter: whoever made it, when they have an employee profile.
ALTER TABLE "vacancies" ADD COLUMN "recruiter_id" UUID;
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "vacancies" v SET "recruiter_id" = u."employee_id" FROM "users" u WHERE u."id" = v."created_by" AND u."employee_id" IS NOT NULL;

-- 2. Every decision, kept.
CREATE TABLE "job_application_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "feedback" TEXT,
    "by_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_application_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "job_application_decisions_application_id_at_idx" ON "job_application_decisions"("application_id", "at");
ALTER TABLE "job_application_decisions" ADD CONSTRAINT "job_application_decisions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_application_decisions" ADD CONSTRAINT "job_application_decisions_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_application_decisions" ADD CONSTRAINT "job_application_decisions_stage_check" CHECK ("stage" IN ('applied', 'review_1', 'review_2', 'final_review', 'screening', 'interview'));
ALTER TABLE "job_application_decisions" ADD CONSTRAINT "job_application_decisions_outcome_check" CHECK ("outcome" IN ('passed', 'accepted', 'rejected', 'unreachable', 'pending', 'declined'));
ALTER TABLE "job_application_decisions" ADD CONSTRAINT "job_application_decisions_feedback_check" CHECK ("feedback" IS NULL OR length("feedback") <= 2000);

-- the hiring manager's review of before, at Shortlisted, and a screening call passed
INSERT INTO "job_application_decisions" ("application_id", "stage", "outcome", "feedback", "by_id", "at")
SELECT "id", 'final_review', CASE "suggestion" WHEN 'next' THEN 'passed' ELSE 'rejected' END, NULLIF(btrim("suggestion_note"), ''), "suggested_by", COALESCE("suggested_at", "updated_at")
FROM "job_applications" WHERE "stage" = 'shortlisted' AND "suggestion" IN ('next', 'reject');
INSERT INTO "job_application_decisions" ("application_id", "stage", "outcome", "feedback", "by_id", "at")
SELECT "id", 'screening', 'accepted', NULLIF(btrim("screening_call_note"), ''), "screening_call_by", COALESCE("screening_call_at", "updated_at")
FROM "job_applications" WHERE "screening_call" = 'passed';

-- 3. Kept at its step: Unreachable or Pending.
ALTER TABLE "job_applications" ADD COLUMN "hold" TEXT;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_hold_check" CHECK ("hold" IS NULL OR "hold" IN ('unreachable', 'pending'));

-- 4. The stages: the history takes the new ones (Shortlisted kept in it) and the new events.
ALTER TABLE "job_application_steps" DROP CONSTRAINT "job_application_steps_stage_check";
ALTER TABLE "job_application_steps" ADD CONSTRAINT "job_application_steps_stage_check" CHECK ("stage" IN (
    'applied', 'review_1', 'review_2', 'final_review', 'screening', 'interview', 'offer', 'hired', 'rejected', 'shortlisted'
));
ALTER TABLE "job_application_steps" DROP CONSTRAINT "job_application_steps_event_check";
ALTER TABLE "job_application_steps" ADD CONSTRAINT "job_application_steps_event_check" CHECK ("event" IN (
    'applied', 'filtered_out', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'restored', 'offer_declined', 'offer_withdrawn',
    'updated', 'to_review', 'decided'
));
ALTER TABLE "job_applications" DROP CONSTRAINT "job_applications_stage_check";
ALTER TABLE "job_applications" DROP CONSTRAINT "job_applications_rejected_from_check";

-- Technical Interview: accepted (or no hiring manager) and the screening call passed
WITH moved AS (
    UPDATE "job_applications" a SET "stage" = 'interview', "suggestion" = NULL, "suggestion_note" = NULL, "suggested_by" = NULL, "suggested_at" = NULL
    FROM "vacancies" v
    WHERE v."id" = a."vacancy_id" AND a."stage" = 'shortlisted' AND (a."suggestion" = 'next' OR v."hiring_manager_id" IS NULL) AND a."screening_call" = 'passed'
    RETURNING a."id"
)
INSERT INTO "job_application_steps" ("id", "application_id", "event", "stage", "note")
SELECT gen_random_uuid(), "id", 'decided', 'interview', 'Moved to the recruitment tree: accepted and the screening call passed' FROM moved;

-- HR Screening: accepted (or no hiring manager)
WITH moved AS (
    UPDATE "job_applications" a SET "stage" = 'screening', "suggestion" = NULL, "suggestion_note" = NULL, "suggested_by" = NULL, "suggested_at" = NULL
    FROM "vacancies" v
    WHERE v."id" = a."vacancy_id" AND a."stage" = 'shortlisted' AND (a."suggestion" = 'next' OR v."hiring_manager_id" IS NULL)
    RETURNING a."id"
)
INSERT INTO "job_application_steps" ("id", "application_id", "event", "stage", "note")
SELECT gen_random_uuid(), "id", 'decided', 'screening', 'Moved to the recruitment tree: accepted by the hiring manager' FROM moved;

-- rejected at the Final Review: the hiring manager rejected them
WITH moved AS (
    UPDATE "job_applications" SET "stage" = 'rejected', "rejected_from" = 'final_review',
        "reject_reason" = COALESCE(NULLIF(btrim("suggestion_note"), ''), 'Rejected by the hiring manager'),
        "suggestion" = NULL, "suggestion_note" = NULL, "suggested_by" = NULL, "suggested_at" = NULL
    WHERE "stage" = 'shortlisted' AND "suggestion" = 'reject'
    RETURNING "id"
)
INSERT INTO "job_application_steps" ("id", "application_id", "event", "stage", "note")
SELECT gen_random_uuid(), "id", 'decided', 'rejected', 'Moved to the recruitment tree: rejected by the hiring manager' FROM moved;

-- Review 2: not reviewed yet
WITH moved AS (
    UPDATE "job_applications" SET "stage" = 'review_2' WHERE "stage" = 'shortlisted' RETURNING "id"
)
INSERT INTO "job_application_steps" ("id", "application_id", "event", "stage", "note")
SELECT gen_random_uuid(), "id", 'decided', 'review_2', 'Moved to the recruitment tree: shortlisted, not reviewed yet' FROM moved;

-- rejected from Shortlisted: restored to Review 2
UPDATE "job_applications" SET "rejected_from" = 'review_2' WHERE "rejected_from" = 'shortlisted';

ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_stage_check" CHECK ("stage" IN (
    'applied', 'review_1', 'review_2', 'final_review', 'screening', 'interview', 'offer', 'hired', 'rejected'
));
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_rejected_from_check" CHECK (
    ("stage" = 'rejected') = ("rejected_from" IS NOT NULL)
    AND ("rejected_from" IS NULL OR "rejected_from" IN ('applied', 'review_1', 'review_2', 'final_review', 'screening', 'interview', 'offer'))
);
