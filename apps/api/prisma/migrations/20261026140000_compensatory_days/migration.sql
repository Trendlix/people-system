-- Compensatory days (owner, 26 October 2026: "is there compensatory leaves in the system?"; then "my compensatory is a
-- compensation with another day in the same month. and rarely to be compensated in cash"; then "if paid in cash make it
-- 1.5"; packages/shared compensatory.ts). Written by hand.
--
-- 1. The Leave Setup's cash rate: the days' pay a day worked is paid in cash instead of a day off (1.5), in whole or half days.
-- 2. A compensatory request: the day worked and the day off asked for (none for a cash one HR recorded), decided as a leave
--    request is (the same statuses, stages and steps), HR's decision day off or cash instead (outcome), and for cash the
--    payroll addition it made (adjustment_id). One a person and day worked, and one a person and day off, while being
--    decided or approved as a day off.
-- 3. Each step of a request, as a leave request's, with the approver a stand-in stood in for.
-- 4. The notifications of a request waiting for its approver and of the employee's own decided: every kind of the newest
--    migration that defined the check (20261025110000_leave_coverage), then the two new.

-- 1.
ALTER TABLE "leave_settings" ADD COLUMN "compensatory_cash_rate" DECIMAL(3,1) NOT NULL DEFAULT 1.5;
ALTER TABLE "leave_settings" ADD CONSTRAINT "leave_settings_compensatory_cash_rate_check" CHECK ("compensatory_cash_rate" BETWEEN 0.5 AND 5);

-- 2.
CREATE TABLE "compensatory_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "day_worked" DATE NOT NULL,
    "day_off" DATE,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "outcome" TEXT,
    "manager_id" UUID,
    "approver_role" TEXT,
    "rejected_stage" TEXT,
    "reject_reason" TEXT,
    "recorded_by_hr" BOOLEAN NOT NULL DEFAULT false,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adjustment_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "compensatory_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compensatory_requests_status_check" CHECK ("status" IN ('with_manager', 'with_hr', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT "compensatory_requests_outcome_check" CHECK (
        ("outcome" IS NULL OR "outcome" IN ('day_off', 'cash'))
        AND ("status" <> 'approved' OR "outcome" IS NOT NULL)
        AND ("day_off" IS NOT NULL OR "outcome" = 'cash')
    ),
    CONSTRAINT "compensatory_requests_manager_check" CHECK (
        ("status" <> 'with_manager' OR "manager_id" IS NOT NULL)
        AND ("approver_role" IS NULL) = ("manager_id" IS NULL)
        AND ("approver_role" IS NULL OR "approver_role" IN ('direct_manager', 'team_lead', 'department_head'))
    ),
    CONSTRAINT "compensatory_requests_rejected_check" CHECK (
        ("status" = 'rejected') = ("rejected_stage" IS NOT NULL)
        AND ("rejected_stage" IS NULL OR "rejected_stage" IN ('manager', 'hr'))
    ),
    CONSTRAINT "compensatory_requests_same_month_check" CHECK ("day_off" IS NULL OR to_char("day_off", 'YYYY-MM') = to_char("day_worked", 'YYYY-MM'))
);

-- 3.
CREATE TABLE "compensatory_steps" (
    "id" BIGSERIAL NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT,
    "comment" TEXT,
    "actor_id" UUID,
    "on_behalf_of" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compensatory_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compensatory_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled')),
    CONSTRAINT "compensatory_steps_decision_check" CHECK (
        ("decision" IS NOT NULL) = ("kind" IN ('manager_decision', 'hr_decision'))
        AND ("decision" IS NULL OR "decision" IN ('approve', 'reject'))
    )
);

CREATE INDEX "compensatory_requests_employee_id_day_worked_idx" ON "compensatory_requests"("employee_id", "day_worked");
CREATE INDEX "compensatory_requests_status_idx" ON "compensatory_requests"("status");
CREATE INDEX "compensatory_requests_manager_id_idx" ON "compensatory_requests"("manager_id");
CREATE INDEX "compensatory_requests_day_worked_idx" ON "compensatory_requests"("day_worked");
CREATE INDEX "compensatory_requests_day_off_idx" ON "compensatory_requests"("day_off");
CREATE UNIQUE INDEX "compensatory_requests_adjustment_id_key" ON "compensatory_requests"("adjustment_id");
CREATE UNIQUE INDEX "compensatory_requests_one_worked_day" ON "compensatory_requests"("employee_id", "day_worked") WHERE "status" IN ('with_manager', 'with_hr', 'approved');
CREATE UNIQUE INDEX "compensatory_requests_one_day_off" ON "compensatory_requests"("employee_id", "day_off") WHERE "status" IN ('with_manager', 'with_hr', 'approved') AND "outcome" IS DISTINCT FROM 'cash';
CREATE INDEX "compensatory_steps_request_id_idx" ON "compensatory_steps"("request_id");

ALTER TABLE "compensatory_requests" ADD CONSTRAINT "compensatory_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compensatory_requests" ADD CONSTRAINT "compensatory_requests_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compensatory_requests" ADD CONSTRAINT "compensatory_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compensatory_requests" ADD CONSTRAINT "compensatory_requests_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "payroll_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compensatory_requests" ADD CONSTRAINT "compensatory_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compensatory_steps" ADD CONSTRAINT "compensatory_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "compensatory_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compensatory_steps" ADD CONSTRAINT "compensatory_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compensatory_steps" ADD CONSTRAINT "compensatory_steps_on_behalf_of_fkey" FOREIGN KEY ("on_behalf_of") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4.
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
    'compensatory_waiting', 'compensatory_decided'
));
