-- The recruitment tree's reviews merged (owner, 5 November 2026: "Consolidate all incoming applicant data directly into
-- the Review 1 tab (renamed 'Applicants'), making the Review 2 tab the final review stage"; asked, "Recruiter's
-- manager", "On to HR Screening"): Review 1 is Applicants now (the recruiter's review of every CV), Review 2 the Final
-- Review (the recruiter's manager's), and the hiring manager's Final Review of before is gone. Those waiting at Review 1
-- wait at Applicants; those at the hiring manager's review move on to HR Screening. A rejection at a review of before is
-- one at the review it is now. The histories and the decisions keep the stages of before.

ALTER TABLE "job_applications" DROP CONSTRAINT "job_applications_stage_check";
ALTER TABLE "job_applications" DROP CONSTRAINT "job_applications_rejected_from_check";

WITH moved AS (
    UPDATE "job_applications" SET "stage" = 'applied' WHERE "stage" = 'review_1' RETURNING "id"
)
INSERT INTO "job_application_steps" ("id", "application_id", "event", "stage", "note")
SELECT gen_random_uuid(), "id", 'decided', 'applied', 'Review 1 merged into Applicants' FROM moved;

WITH moved AS (
    UPDATE "job_applications" SET "stage" = 'screening', "hold" = NULL WHERE "stage" = 'final_review' RETURNING "id"
)
INSERT INTO "job_application_steps" ("id", "application_id", "event", "stage", "note")
SELECT gen_random_uuid(), "id", 'decided', 'screening', 'The hiring manager review is no more: on to HR Screening' FROM moved;

UPDATE "job_applications" SET "rejected_from" = 'applied' WHERE "rejected_from" = 'review_1';
UPDATE "job_applications" SET "rejected_from" = 'review_2' WHERE "rejected_from" = 'final_review';

ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_stage_check" CHECK ("stage" IN (
    'applied', 'review_2', 'screening', 'interview', 'offer', 'hired', 'rejected'
));
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_rejected_from_check" CHECK (
    ("stage" = 'rejected') = ("rejected_from" IS NOT NULL)
    AND ("rejected_from" IS NULL OR "rejected_from" IN ('applied', 'review_2', 'screening', 'interview', 'offer'))
);
