-- Leave and attendance changes after the payroll moved on (owner's brief, 27 October 2026, after the proof of the night
-- before: with July's run with the CEO, HR recording leave in July answered 201 approved with no warning, and the line was
-- unchanged). Written by hand.
--
-- 1. payroll_locked_changes: a leave, permission, work from home or official duty change whose days fall in a month whose
--    payroll had moved on (with the CEO, approved or paid) when it was made. The run keeps its lines, so HR corrects it by
--    hand on a later payroll: listed on Unsettled until HR marks it handled (handled_how by_hand), or the month's run
--    returns to draft and is refilled (refilled). A table of its own rather than a flag on each request: one query lists
--    every kind, the handling is explicit, and a refill clears a month without touching the requests. The request is named
--    by its kind and id (four tables, so no foreign key); a summary line says its type and days, never its reason.
-- 2. The notification of such a change, for HR and Finance: notifications_kind_check stated again with every kind of the
--    newest migration that defined it (20261026180000_notification_kinds), then payroll_locked_change.

-- 1.
CREATE TABLE "payroll_locked_changes" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "run_status" TEXT NOT NULL,
    "request_kind" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handled_by" UUID,
    "handled_at" TIMESTAMPTZ,
    "handled_how" TEXT,
    "handled_note" TEXT,

    CONSTRAINT "payroll_locked_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_locked_changes_run_status_check" CHECK ("run_status" IN ('pending_ceo', 'approved', 'paid')),
    CONSTRAINT "payroll_locked_changes_request_kind_check" CHECK ("request_kind" IN ('leave', 'permission', 'wfh', 'od')),
    CONSTRAINT "payroll_locked_changes_action_check" CHECK ("action" IN ('recorded', 'approved', 'cancelled')),
    CONSTRAINT "payroll_locked_changes_days_check" CHECK ("to_date" >= "from_date"),
    CONSTRAINT "payroll_locked_changes_handled_check" CHECK (
        ("handled_at" IS NULL) = ("handled_how" IS NULL)
        AND ("handled_how" IS NULL OR "handled_how" IN ('by_hand', 'refilled'))
    )
);

ALTER TABLE "payroll_locked_changes" ADD CONSTRAINT "payroll_locked_changes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_locked_changes" ADD CONSTRAINT "payroll_locked_changes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_locked_changes" ADD CONSTRAINT "payroll_locked_changes_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payroll_locked_changes_employee_id_month_idx" ON "payroll_locked_changes"("employee_id", "month");
CREATE INDEX "payroll_locked_changes_request_kind_request_id_idx" ON "payroll_locked_changes"("request_kind", "request_id");
CREATE INDEX "payroll_locked_changes_handled_at_idx" ON "payroll_locked_changes"("handled_at");

-- 2.
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
    'cv_suggestions',
    'leave_cover',
    'stand_in',
    'compensatory_waiting', 'compensatory_decided',
    'resignation_new', 'resignation_update',
    'payroll_locked_change'
));
