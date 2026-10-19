-- Permission requests (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2
-- hours per day"; asked how it is asked for, "In the system, like leave"; asked where its limits are set, "Yes, in Leave
-- Setup"). The rules: packages/shared permissions.ts.
--
-- 1. The Leave Setup's limits: 4 hours a month (0: no permission), at most 2 a day, in half hours.
-- 2. A request: a day, its hours in half hours (more than 0), the times when given (from before to, together), decided
--    as a leave request is (the same statuses, stages and steps), with the manager stage's decider and what they are.
-- 3. Each step of a request, as a leave request's.

-- 1.
ALTER TABLE "leave_settings"
    ADD COLUMN "permission_hours_per_month" DECIMAL(4,1) NOT NULL DEFAULT 4,
    ADD COLUMN "permission_max_hours_per_day" DECIMAL(3,1) NOT NULL DEFAULT 2;
ALTER TABLE "leave_settings" ADD CONSTRAINT "leave_settings_permission_check" CHECK (
    "permission_hours_per_month" BETWEEN 0 AND 40 AND "permission_hours_per_month" * 2 = round("permission_hours_per_month" * 2)
    AND "permission_max_hours_per_day" BETWEEN 0.5 AND 8 AND "permission_max_hours_per_day" * 2 = round("permission_max_hours_per_day" * 2)
);

-- 2.
CREATE TABLE "permission_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(3,1) NOT NULL,
    "from_time" TIME(0),
    "to_time" TIME(0),
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "manager_id" UUID,
    "approver_role" TEXT,
    "rejected_stage" TEXT,
    "reject_reason" TEXT,
    "recorded_by_hr" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "permission_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "permission_requests_hours_check" CHECK ("hours" > 0 AND "hours" <= 8 AND "hours" * 2 = round("hours" * 2)),
    CONSTRAINT "permission_requests_times_check" CHECK (("from_time" IS NULL) = ("to_time" IS NULL) AND ("from_time" IS NULL OR "from_time" < "to_time")),
    CONSTRAINT "permission_requests_status_check" CHECK ("status" IN ('with_manager', 'with_hr', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT "permission_requests_manager_check" CHECK (
        ("status" <> 'with_manager' OR "manager_id" IS NOT NULL)
        AND ("approver_role" IS NULL) = ("manager_id" IS NULL)
        AND ("approver_role" IS NULL OR "approver_role" IN ('direct_manager', 'team_lead', 'department_head'))
    ),
    CONSTRAINT "permission_requests_rejected_check" CHECK (
        ("status" = 'rejected') = ("rejected_stage" IS NOT NULL)
        AND ("rejected_stage" IS NULL OR "rejected_stage" IN ('manager', 'hr'))
    )
);

-- 3.
CREATE TABLE "permission_request_steps" (
    "id" BIGSERIAL NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT,
    "comment" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_request_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "permission_request_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled')),
    CONSTRAINT "permission_request_steps_decision_check" CHECK (
        ("decision" IS NOT NULL) = ("kind" IN ('manager_decision', 'hr_decision'))
        AND ("decision" IS NULL OR "decision" IN ('approve', 'reject'))
    )
);

CREATE INDEX "permission_requests_employee_id_date_idx" ON "permission_requests"("employee_id", "date");
CREATE INDEX "permission_requests_status_idx" ON "permission_requests"("status");
CREATE INDEX "permission_requests_manager_id_idx" ON "permission_requests"("manager_id");
CREATE INDEX "permission_request_steps_request_id_idx" ON "permission_request_steps"("request_id");

ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "permission_request_steps" ADD CONSTRAINT "permission_request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "permission_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "permission_request_steps" ADD CONSTRAINT "permission_request_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
