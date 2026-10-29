-- The hiring steps (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the shortlisted and accept or
-- reject them - HR Screening and scheduling", then "Score Card for each of them" (HR and the hiring manager), "then the
-- candidate to be selected" and "and start the job offer cycle"). He chose a screening call with its result before an
-- interview is scheduled ("Screening call + result"), the manager's rejection confirmed by HR ("HR confirms") and the
-- manager told once a batch (one message).

-- HR's screening call on a shortlisted applicant (the hiring manager's accepted one): passed or failed, a note, who, when
ALTER TABLE "job_applications" ADD COLUMN "screening_call" TEXT;
ALTER TABLE "job_applications" ADD COLUMN "screening_call_note" TEXT;
ALTER TABLE "job_applications" ADD COLUMN "screening_call_by" UUID;
ALTER TABLE "job_applications" ADD COLUMN "screening_call_at" TIMESTAMPTZ;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_screening_call_check" CHECK ("screening_call" IS NULL OR "screening_call" IN ('passed', 'failed'));
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_screening_call_by_fkey" FOREIGN KEY ("screening_call_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- the hiring manager told of a shortlist to review (packages/shared notifications.ts NOTIFICATION_KINDS)
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN (
    'leave_waiting',
    'leave_decided',
    'permission_waiting',
    'permission_decided',
    'reimbursement_waiting',
    'reimbursement_decided',
    'reimbursement_paid',
    'correction_waiting',
    'correction_decided',
    'raise_request_waiting',
    'pay_raise_waiting',
    'pay_raise_decided',
    'payslip_issued',
    'home_location_waiting',
    'home_location_decided',
    'check_in_reminder',
    'check_out_reminder',
    'kpi_self_rating',
    'kpi_waiting',
    'kpi_ready_to_sign',
    'wfh_waiting',
    'wfh_decided',
    'custody_handover',
    'custody_return',
    'custody_overdue',
    'custody_unsigned',
    'offboarding_items',
    'offboarding_cleared',
    'exit_interview',
    'vacancy_waiting',
    'vacancy_decided',
    'applications_new',
    'interview_scheduled',
    'interview_feedback',
    'hiring_suggestion',
    'shortlist_review',
    'onboarding_items',
    'access_hold',
    'access_grace',
    'access_grace_ending',
    'access_held',
    'od_waiting',
    'od_decided',
    'access_no_contract',
    'meeting_connection',
    'screening_mention',
    'check_in_location_ending',
    'cv_suggestions',
    'leave_cover',
    'stand_in',
    'compensatory_waiting',
    'compensatory_decided',
    'resignation_new',
    'resignation_update',
    'payroll_locked_change'
));
