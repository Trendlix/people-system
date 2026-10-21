-- Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"; in
-- Zoho People it was a leave type): a working day in another place, not leave. Asked, the owner chose "Manager, then
-- HR", "its 2 days per month with a gap of 1 week between each record (Biweekly)" and "A day before". The rules:
-- packages/shared wfh.ts.
--
-- 1. The Leave Setup's limits: 2 days a calendar month (0: none), any two at least 7 days apart.
-- 2. A work from home day: the day, why, decided as a leave request is (the same statuses, stages and steps), with the
--    manager stage's decider and what they are; recorded by HR (with the warnings it was recorded past) or imported
--    from Zoho People's history. One a person and day while being decided or approved.
-- 3. Each step of a request, as a leave request's, and imported from Zoho People.
-- 4. The notifications of a request waiting for its approver and of the employee's own decided.

-- 1.
ALTER TABLE "leave_settings"
    ADD COLUMN "wfh_days_per_month" INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN "wfh_min_gap_days" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "leave_settings" ADD CONSTRAINT "leave_settings_wfh_check" CHECK (
    "wfh_days_per_month" BETWEEN 0 AND 20 AND "wfh_min_gap_days" BETWEEN 1 AND 31
);

-- 2.
CREATE TABLE "wfh_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "manager_id" UUID,
    "approver_role" TEXT,
    "rejected_stage" TEXT,
    "reject_reason" TEXT,
    "recorded_by_hr" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'system',
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wfh_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wfh_requests_status_check" CHECK ("status" IN ('with_manager', 'with_hr', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT "wfh_requests_source_check" CHECK ("source" IN ('system', 'zoho')),
    CONSTRAINT "wfh_requests_manager_check" CHECK (
        ("status" <> 'with_manager' OR "manager_id" IS NOT NULL)
        AND ("approver_role" IS NULL) = ("manager_id" IS NULL)
        AND ("approver_role" IS NULL OR "approver_role" IN ('direct_manager', 'team_lead', 'department_head'))
    ),
    CONSTRAINT "wfh_requests_rejected_check" CHECK (
        ("status" = 'rejected') = ("rejected_stage" IS NOT NULL)
        AND ("rejected_stage" IS NULL OR "rejected_stage" IN ('manager', 'hr'))
    )
);

-- 3.
CREATE TABLE "wfh_request_steps" (
    "id" BIGSERIAL NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT,
    "comment" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wfh_request_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wfh_request_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled', 'imported')),
    CONSTRAINT "wfh_request_steps_decision_check" CHECK (
        ("decision" IS NOT NULL) = ("kind" IN ('manager_decision', 'hr_decision'))
        AND ("decision" IS NULL OR "decision" IN ('approve', 'reject'))
    )
);

CREATE INDEX "wfh_requests_employee_id_date_idx" ON "wfh_requests"("employee_id", "date");
CREATE INDEX "wfh_requests_status_idx" ON "wfh_requests"("status");
CREATE INDEX "wfh_requests_manager_id_idx" ON "wfh_requests"("manager_id");
CREATE INDEX "wfh_requests_date_idx" ON "wfh_requests"("date");
CREATE UNIQUE INDEX "wfh_requests_one_a_day" ON "wfh_requests"("employee_id", "date") WHERE "status" IN ('with_manager', 'with_hr', 'approved');
CREATE INDEX "wfh_request_steps_request_id_idx" ON "wfh_request_steps"("request_id");

ALTER TABLE "wfh_requests" ADD CONSTRAINT "wfh_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wfh_requests" ADD CONSTRAINT "wfh_requests_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wfh_requests" ADD CONSTRAINT "wfh_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wfh_requests" ADD CONSTRAINT "wfh_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wfh_request_steps" ADD CONSTRAINT "wfh_request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "wfh_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wfh_request_steps" ADD CONSTRAINT "wfh_request_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
    'wfh_waiting', 'wfh_decided'
));
