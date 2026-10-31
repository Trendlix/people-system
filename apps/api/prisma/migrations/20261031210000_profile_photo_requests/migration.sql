-- A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
-- and approved from the HR"). The file is kept in the database, as the employee file's papers are. Approved, it becomes
-- the employee file's personal photo (photo_id); rejected, or cancelled by the employee while it waits, nothing changes.
CREATE TABLE "profile_photo_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "photo_id" UUID,
    CONSTRAINT "profile_photo_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profile_photo_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT "profile_photo_requests_mime_type_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp'))
);
CREATE INDEX "profile_photo_requests_status_idx" ON "profile_photo_requests"("status");
CREATE INDEX "profile_photo_requests_employee_id_idx" ON "profile_photo_requests"("employee_id");
ALTER TABLE "profile_photo_requests" ADD CONSTRAINT "profile_photo_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_photo_requests" ADD CONSTRAINT "profile_photo_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profile_photo_requests" ADD CONSTRAINT "profile_photo_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "profile_photo_requests" ADD CONSTRAINT "profile_photo_requests_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "paperwork_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- those who decide a new photo told one waits, and the employee told it was decided (packages/shared notifications.ts
-- NOTIFICATION_KINDS)
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
    'payroll_locked_change',
    'shortlist_review',
    'photo_request_waiting',
    'photo_request_decided'
));
