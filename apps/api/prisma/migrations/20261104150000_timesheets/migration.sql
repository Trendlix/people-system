-- Timesheets (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly", "Only those HR switches on";
-- packages/shared timesheets.ts): the employment's switch, a week of someone's hours and its lines, and the two notices.
ALTER TABLE "employments" ADD COLUMN "works_on_timesheets" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "timesheet_weeks" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approver_id" UUID,
    "submitted_at" TIMESTAMPTZ,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "timesheet_weeks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "timesheet_weeks_status_check" CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected')),
    -- a week starts on a Sunday
    CONSTRAINT "timesheet_weeks_sunday_check" CHECK (EXTRACT(DOW FROM "week_start") = 0)
);
CREATE UNIQUE INDEX "timesheet_weeks_employee_id_week_start_key" ON "timesheet_weeks"("employee_id", "week_start");
CREATE INDEX "timesheet_weeks_approver_id_status_idx" ON "timesheet_weeks"("approver_id", "status");
CREATE INDEX "timesheet_weeks_status_week_start_idx" ON "timesheet_weeks"("status", "week_start");
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "timesheet_entries" (
    "id" UUID NOT NULL,
    "week_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "client_account_id" UUID,
    "task" TEXT,
    "hours" DECIMAL(5,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "timesheet_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "timesheet_entries_hours_check" CHECK ("hours" > 0 AND "hours" <= 24),
    CONSTRAINT "timesheet_entries_what_check" CHECK ("client_account_id" IS NOT NULL OR "task" IS NOT NULL)
);
CREATE INDEX "timesheet_entries_week_id_idx" ON "timesheet_entries"("week_id");
CREATE INDEX "timesheet_entries_client_account_id_date_idx" ON "timesheet_entries"("client_account_id", "date");
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "timesheet_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_client_account_id_fkey" FOREIGN KEY ("client_account_id") REFERENCES "client_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
    'photo_request_decided',
    'hr_message',
    'manual_change',
    'timesheet_waiting',
    'timesheet_decided'
));
