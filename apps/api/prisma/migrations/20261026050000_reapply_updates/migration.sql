-- Applying again for the same job updates the application (owner, 25 October 2026: "if an employee updated the cv and
-- reapplied, how will he be treated in the system?"; asked, "Update their application"; packages/shared reapply.ts).
-- Written by hand. While the application is open, the new CV becomes current and the earlier one is kept; a step
-- "Updated by the candidate" is recorded; the applicant may get "Application updated" on WhatsApp. HR is told through
-- the existing kind applications_new, so no notification kind is added (notifications_kind_check stays as it is).

-- 1. The CVs an application held before its current one, kept as they were (apart, so the lists never read them): when
--    each was sent, when the new one replaced it, and the address the new one came from (counted in the careers page's
--    hourly limits). Deleted with the application.
CREATE TABLE "job_application_earlier_cvs" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL,
    "replaced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "job_application_earlier_cvs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_application_earlier_cvs_application_id_sent_at_idx" ON "job_application_earlier_cvs"("application_id", "sent_at");
CREATE INDEX "job_application_earlier_cvs_ip_replaced_at_idx" ON "job_application_earlier_cvs"("ip", "replaced_at");
CREATE INDEX "job_application_earlier_cvs_replaced_at_idx" ON "job_application_earlier_cvs"("replaced_at");

ALTER TABLE "job_application_earlier_cvs" ADD CONSTRAINT "job_application_earlier_cvs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. When the person last sent a new CV by applying again: the "CV updated" mark on the board and the lists (7 days).
ALTER TABLE "job_applications" ADD COLUMN "cv_updated_at" TIMESTAMPTZ;

-- 3. An application's history may say it was updated by the candidate (every event of before kept).
ALTER TABLE "job_application_steps" DROP CONSTRAINT "job_application_steps_event_check";
ALTER TABLE "job_application_steps" ADD CONSTRAINT "job_application_steps_event_check" CHECK ("event" IN (
    'applied', 'filtered_out', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'restored', 'offer_declined', 'offer_withdrawn',
    'updated'
));

-- 4. WhatsApp's messages may be the new template too: "We've updated your application" (application_updated). Every
--    template of the newest migration that defined the check (20261025110000_leave_coverage) is kept.
ALTER TABLE "whatsapp_messages" DROP CONSTRAINT "whatsapp_messages_template_check";
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_template_check" CHECK ("template" IN (
    'approval_waiting', 'approvals_digest', 'request_update', 'payslip_ready',
    'access_on_hold', 'access_grace', 'access_grace_ending',
    'check_in_reminder', 'check_out_reminder', 'interview_panel',
    'application_received', 'cv_received', 'interview_invitation', 'interview_updated', 'interview_cancelled', 'interview_reminder',
    'test_message', 'stop_confirmation',
    'cover_assigned',
    'application_updated'
));
