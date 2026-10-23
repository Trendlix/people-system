-- Official duty, OD (owner, 23 October 2026: "Official duty (OD) requests. The plan has OD as a third attendance mode
-- beside Office and WFH, needing an approved request"). Asked, the owner chose "Manager, then HR", "Ahead or up to 3
-- days after" and "Check in from anywhere". The rules: packages/shared official-duty.ts.
--
-- 1. An official duty: one day or several in a row, a full day or part of one (from–to times, one day only), where and
--    why, whether asked after its first day; decided as a leave request is (the same statuses, stages and steps), with
--    the manager stage's decider and what they are.
-- 2. Each step of a request, as a leave request's.
-- 3. A press of Check in or Check out within an approved official duty: its request.
-- 4. The notifications of a request waiting for its approver and of the employee's own decided (with the kinds of
--    access following the contract, 23 October 2026, already in packages/shared notifications.ts).

-- 1.
CREATE TABLE "od_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "full_day" BOOLEAN NOT NULL DEFAULT true,
    "from_time" TIME(0),
    "to_time" TIME(0),
    "place" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "manager_id" UUID,
    "approver_role" TEXT,
    "rejected_stage" TEXT,
    "reject_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "od_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "od_requests_status_check" CHECK ("status" IN ('with_manager', 'with_hr', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT "od_requests_days_check" CHECK ("end_date" >= "start_date" AND "end_date" - "start_date" < 31),
    CONSTRAINT "od_requests_times_check" CHECK (
        ("full_day" AND "from_time" IS NULL AND "to_time" IS NULL)
        OR (NOT "full_day" AND "from_time" IS NOT NULL AND "to_time" IS NOT NULL AND "to_time" > "from_time" AND "end_date" = "start_date")
    ),
    CONSTRAINT "od_requests_text_check" CHECK (length(btrim("place")) BETWEEN 1 AND 200 AND length(btrim("reason")) BETWEEN 1 AND 1000),
    CONSTRAINT "od_requests_manager_check" CHECK (
        ("status" <> 'with_manager' OR "manager_id" IS NOT NULL)
        AND ("approver_role" IS NULL) = ("manager_id" IS NULL)
        AND ("approver_role" IS NULL OR "approver_role" IN ('direct_manager', 'team_lead', 'department_head'))
    ),
    CONSTRAINT "od_requests_rejected_check" CHECK (
        ("status" = 'rejected') = ("rejected_stage" IS NOT NULL)
        AND ("rejected_stage" IS NULL OR "rejected_stage" IN ('manager', 'hr'))
    )
);

-- 2.
CREATE TABLE "od_request_steps" (
    "id" BIGSERIAL NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT,
    "comment" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "od_request_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "od_request_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'manager_decision', 'hr_decision', 'cancelled')),
    CONSTRAINT "od_request_steps_decision_check" CHECK (
        ("decision" IS NOT NULL) = ("kind" IN ('manager_decision', 'hr_decision'))
        AND ("decision" IS NULL OR "decision" IN ('approve', 'reject'))
    )
);

CREATE INDEX "od_requests_employee_id_start_date_idx" ON "od_requests"("employee_id", "start_date");
CREATE INDEX "od_requests_status_idx" ON "od_requests"("status");
CREATE INDEX "od_requests_manager_id_idx" ON "od_requests"("manager_id");
CREATE INDEX "od_requests_start_date_end_date_idx" ON "od_requests"("start_date", "end_date");
CREATE INDEX "od_request_steps_request_id_idx" ON "od_request_steps"("request_id");

ALTER TABLE "od_requests" ADD CONSTRAINT "od_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "od_requests" ADD CONSTRAINT "od_requests_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "od_requests" ADD CONSTRAINT "od_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "od_requests" ADD CONSTRAINT "od_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "od_request_steps" ADD CONSTRAINT "od_request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "od_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "od_request_steps" ADD CONSTRAINT "od_request_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3.
ALTER TABLE "attendance_punches" ADD COLUMN "od_request_id" UUID;
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_od_request_id_fkey" FOREIGN KEY ("od_request_id") REFERENCES "od_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
    'od_waiting', 'od_decided'
));
