-- Attendance corrections (owner, 19 October 2026, "Proceed with those": "Attendance corrections with approval ("I
-- forgot to check out")"). The rules: packages/shared attendance-corrections.ts.
--
-- 1. A correction asked for (or made directly by HR): the day, what was wrong, the right moments (none: as on record),
--    why, the day as shown when asked, decided as a leave request is (the same statuses, stages and steps), with the
--    manager stage's decider and what they are, and when its approval changed the day.
-- 2. Each step of a correction, as a leave request's.
-- 3. A corrected day: kept as source 'correction' over the day it corrects, which stays as it was; the day it was
--    applied over as it was then, and the correction.

-- 1.
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "check_in" TIMESTAMPTZ,
    "check_out" TIMESTAMPTZ,
    "reason" TEXT NOT NULL,
    "day_before" JSONB,
    "status" TEXT NOT NULL,
    "manager_id" UUID,
    "approver_role" TEXT,
    "rejected_stage" TEXT,
    "reject_reason" TEXT,
    "recorded_by_hr" BOOLEAN NOT NULL DEFAULT false,
    "applied_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_corrections_kind_check" CHECK ("kind" IN ('forgot_check_in', 'forgot_check_out', 'wrong_time', 'worked_remotely')),
    CONSTRAINT "attendance_corrections_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 500),
    CONSTRAINT "attendance_corrections_times_check" CHECK ("check_in" IS NULL OR "check_out" IS NULL OR "check_in" < "check_out"),
    CONSTRAINT "attendance_corrections_status_check" CHECK ("status" IN ('with_manager', 'with_hr', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT "attendance_corrections_manager_check" CHECK (
        ("status" <> 'with_manager' OR "manager_id" IS NOT NULL)
        AND ("approver_role" IS NULL) = ("manager_id" IS NULL)
        AND ("approver_role" IS NULL OR "approver_role" IN ('direct_manager', 'team_lead', 'department_head'))
    ),
    CONSTRAINT "attendance_corrections_rejected_check" CHECK (
        ("status" = 'rejected') = ("rejected_stage" IS NOT NULL)
        AND ("rejected_stage" IS NULL OR "rejected_stage" IN ('manager', 'hr'))
    ),
    CONSTRAINT "attendance_corrections_applied_check" CHECK ("applied_at" IS NULL OR "status" = 'approved')
);

-- 2.
CREATE TABLE "attendance_correction_steps" (
    "id" BIGSERIAL NOT NULL,
    "correction_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT,
    "comment" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_correction_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_correction_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled')),
    CONSTRAINT "attendance_correction_steps_decision_check" CHECK (
        ("decision" IS NOT NULL) = ("kind" IN ('manager_decision', 'hr_decision'))
        AND ("decision" IS NULL OR "decision" IN ('approve', 'reject'))
    )
);

-- 3.
ALTER TABLE "attendance_days" ADD COLUMN "corrected_from" JSONB, ADD COLUMN "correction_id" UUID;
ALTER TABLE "attendance_days" DROP CONSTRAINT "attendance_days_source_check";
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_source_check" CHECK ("source" IN ('zoho', 'system', 'device', 'correction'));
-- only a corrected day names a correction and the day it was applied over (the correction may be gone since: null)
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_correction_check" CHECK ("source" = 'correction' OR ("correction_id" IS NULL AND "corrected_from" IS NULL));

CREATE INDEX "attendance_corrections_employee_id_date_idx" ON "attendance_corrections"("employee_id", "date");
CREATE INDEX "attendance_corrections_status_idx" ON "attendance_corrections"("status");
CREATE INDEX "attendance_corrections_manager_id_idx" ON "attendance_corrections"("manager_id");
CREATE INDEX "attendance_correction_steps_correction_id_idx" ON "attendance_correction_steps"("correction_id");

ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_steps" ADD CONSTRAINT "attendance_correction_steps_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "attendance_corrections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_steps" ADD CONSTRAINT "attendance_correction_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "attendance_corrections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
