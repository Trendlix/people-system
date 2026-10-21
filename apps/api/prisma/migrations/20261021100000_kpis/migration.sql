-- KPIs (owner, 21 October 2026: "lets start with the KPI's First"; trendlix-hrms-handoff docs/spec.md §11). The owner
-- chose "Full framework per role" (four pillars with fixed weights; every job title a template of metrics from its JD,
-- each with a criteria scale, one criterion picked a month), "Self, manager, HR, sign-off", "Attendance: Yes, as the
-- sheet", "Last month's KPI, this pay", "As the sheet: full at 80%+" and "Templates: HR". The rules: packages/shared
-- kpis.ts; the module: apps/api/src/kpis.
--
-- 1. The KPI settings, one row: the days of the next month each step is due by (3, 6, 8, 10), each after the one before.
-- 2. The templates' versions: a draft (one a job title at most) and the published ones, each with the Attendance
--    metric's points and, once published, the 1st of the month its scorecards open from.
-- 3. A version's metrics, in order: pillar 1–4, name, the texts, the target points and the criteria scale (a JSON list).
-- 4. The scorecards, one a person and month (its first day), with their step, who scores them, the attendance read,
--    each step's comment, who and when, the score kept for the lists, and the reminders sent.
-- 5. Each metric's picks on a scorecard: the employee's, the manager's and HR's calibration with its reason.
-- 6. The steps logged on a scorecard.
-- 7. The notifications take the three KPI kinds.

-- 1.
CREATE TABLE "kpi_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "self_rating_day" INTEGER NOT NULL DEFAULT 3,
    "manager_day" INTEGER NOT NULL DEFAULT 6,
    "hr_day" INTEGER NOT NULL DEFAULT 8,
    "sign_off_day" INTEGER NOT NULL DEFAULT 10,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "kpi_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_settings_one_row_check" CHECK ("id" = 1),
    -- days every month has, each step after the one before
    CONSTRAINT "kpi_settings_days_check" CHECK (
        "self_rating_day" >= 1 AND "self_rating_day" < "manager_day" AND "manager_day" < "hr_day"
        AND "hr_day" < "sign_off_day" AND "sign_off_day" <= 28
    )
);

ALTER TABLE "kpi_settings" ADD CONSTRAINT "kpi_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "kpi_settings" ("id", "updated_at") VALUES (1, now());

-- 2.
CREATE TABLE "kpi_templates" (
    "id" UUID NOT NULL,
    "job_title_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "attendance_points" INTEGER NOT NULL DEFAULT 20,
    "opens_from" DATE,
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kpi_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_templates_status_check" CHECK ("status" IN ('draft', 'published')),
    CONSTRAINT "kpi_templates_version_check" CHECK ("version" >= 1),
    CONSTRAINT "kpi_templates_attendance_points_check" CHECK ("attendance_points" BETWEEN 1 AND 200),
    -- published: since when, and from which month's 1st its scorecards open; a draft has neither
    CONSTRAINT "kpi_templates_published_check" CHECK (
        ("status" = 'published' AND "opens_from" IS NOT NULL AND "published_at" IS NOT NULL AND date_part('day', "opens_from") = 1)
        OR ("status" = 'draft' AND "opens_from" IS NULL AND "published_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "kpi_templates_job_title_id_version_key" ON "kpi_templates"("job_title_id", "version");

CREATE INDEX "kpi_templates_job_title_id_status_idx" ON "kpi_templates"("job_title_id", "status");

-- one draft a job title at most
CREATE UNIQUE INDEX "kpi_templates_one_draft" ON "kpi_templates"("job_title_id") WHERE "status" = 'draft';

ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3.
CREATE TABLE "kpi_metrics" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "pillar" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT,
    "how_measured" TEXT,
    "jd_duty" TEXT,
    "target_points" INTEGER NOT NULL,
    "criteria" JSONB NOT NULL,

    CONSTRAINT "kpi_metrics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_metrics_pillar_check" CHECK ("pillar" BETWEEN 1 AND 4),
    CONSTRAINT "kpi_metrics_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "kpi_metrics_target_points_check" CHECK ("target_points" BETWEEN 1 AND 200),
    CONSTRAINT "kpi_metrics_criteria_check" CHECK (jsonb_typeof("criteria") = 'array' AND jsonb_array_length("criteria") BETWEEN 2 AND 6)
);

CREATE UNIQUE INDEX "kpi_metrics_template_id_position_key" ON "kpi_metrics"("template_id", "position");

ALTER TABLE "kpi_metrics" ADD CONSTRAINT "kpi_metrics_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "kpi_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4.
CREATE TABLE "kpi_scorecards" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "template_id" UUID NOT NULL,
    "department_id" UUID,
    "status" TEXT NOT NULL,
    "scorer" TEXT NOT NULL,
    "manager_id" UUID,
    "approver_role" TEXT,
    "attendance_ratio" DECIMAL(8,4),
    "attendance_score" DECIMAL(8,4),
    "attendance_achieved" INTEGER NOT NULL,
    "attendance_source" TEXT NOT NULL,
    "self_comment" TEXT,
    "self_submitted_at" TIMESTAMPTZ,
    "self_missed" BOOLEAN NOT NULL DEFAULT false,
    "manager_comment" TEXT,
    "scored_at" TIMESTAMPTZ,
    "scored_by" UUID,
    "hr_comment" TEXT,
    "calibrated_at" TIMESTAMPTZ,
    "calibrated_by" UUID,
    "employee_signed_at" TIMESTAMPTZ,
    "employee_sign_comment" TEXT,
    "manager_signed_at" TIMESTAMPTZ,
    "manager_signed_by" UUID,
    "manager_sign_comment" TEXT,
    "final_at" TIMESTAMPTZ,
    "final_percent" DECIMAL(5,1),
    "level" TEXT,
    "pillars" JSONB,
    "reminders_sent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kpi_scorecards_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_scorecards_month_check" CHECK (date_part('day', "month") = 1),
    CONSTRAINT "kpi_scorecards_status_check" CHECK ("status" IN ('self_rating', 'manager', 'hr', 'sign_off', 'final')),
    -- a manager scores with the approver role they are in charge as; HR, the CEO and a Super Admin without either
    CONSTRAINT "kpi_scorecards_scorer_check" CHECK (
        ("scorer" = 'manager' AND "manager_id" IS NOT NULL AND "approver_role" IN ('direct_manager', 'team_lead', 'department_head'))
        OR ("scorer" IN ('hr', 'ceo', 'super_admin') AND "manager_id" IS NULL AND "approver_role" IS NULL)
    ),
    CONSTRAINT "kpi_scorecards_attendance_source_check" CHECK ("attendance_source" IN ('payroll', 'attendance', 'none')),
    CONSTRAINT "kpi_scorecards_attendance_achieved_check" CHECK ("attendance_achieved" BETWEEN 0 AND 200),
    CONSTRAINT "kpi_scorecards_final_percent_check" CHECK ("final_percent" IS NULL OR "final_percent" BETWEEN 0 AND 110),
    CONSTRAINT "kpi_scorecards_level_check" CHECK ("level" IS NULL OR "level" IN ('unacceptable', 'unsatisfactory', 'needs_improvement', 'meets', 'above')),
    -- a final scorecard has its score and the moment it became final
    CONSTRAINT "kpi_scorecards_final_check" CHECK ("status" <> 'final' OR ("final_at" IS NOT NULL AND "final_percent" IS NOT NULL AND "level" IS NOT NULL)),
    CONSTRAINT "kpi_scorecards_reminders_check" CHECK ("reminders_sent" <@ ARRAY['self_rating', 'manager', 'hr', 'sign_off']::TEXT[])
);

CREATE UNIQUE INDEX "kpi_scorecards_employee_id_month_key" ON "kpi_scorecards"("employee_id", "month");

CREATE INDEX "kpi_scorecards_month_idx" ON "kpi_scorecards"("month");

CREATE INDEX "kpi_scorecards_status_idx" ON "kpi_scorecards"("status");

CREATE INDEX "kpi_scorecards_manager_id_idx" ON "kpi_scorecards"("manager_id");

CREATE INDEX "kpi_scorecards_template_id_idx" ON "kpi_scorecards"("template_id");

ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "kpi_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_scored_by_fkey" FOREIGN KEY ("scored_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_calibrated_by_fkey" FOREIGN KEY ("calibrated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kpi_scorecards" ADD CONSTRAINT "kpi_scorecards_manager_signed_by_fkey" FOREIGN KEY ("manager_signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5.
CREATE TABLE "kpi_scores" (
    "scorecard_id" UUID NOT NULL,
    "metric_id" UUID NOT NULL,
    "self_choice" INTEGER,
    "self_comment" TEXT,
    "manager_choice" INTEGER,
    "manager_comment" TEXT,
    "hr_choice" INTEGER,
    "hr_reason" TEXT,

    CONSTRAINT "kpi_scores_pkey" PRIMARY KEY ("scorecard_id", "metric_id"),
    CONSTRAINT "kpi_scores_choices_check" CHECK (
        ("self_choice" IS NULL OR "self_choice" BETWEEN 0 AND 5) AND ("manager_choice" IS NULL OR "manager_choice" BETWEEN 0 AND 5)
        AND ("hr_choice" IS NULL OR "hr_choice" BETWEEN 0 AND 5)
    ),
    -- HR's change of a pick has its reason
    CONSTRAINT "kpi_scores_hr_reason_check" CHECK ("hr_choice" IS NULL OR length(btrim("hr_reason")) >= 1)
);

CREATE INDEX "kpi_scores_metric_id_idx" ON "kpi_scores"("metric_id");

ALTER TABLE "kpi_scores" ADD CONSTRAINT "kpi_scores_scorecard_id_fkey" FOREIGN KEY ("scorecard_id") REFERENCES "kpi_scorecards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kpi_scores" ADD CONSTRAINT "kpi_scores_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "kpi_metrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6.
CREATE TABLE "kpi_scorecard_steps" (
    "id" BIGSERIAL NOT NULL,
    "scorecard_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "comment" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_scorecard_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_scorecard_steps_kind_check" CHECK ("kind" IN (
        'opened', 'self_rated', 'self_missed', 'scored', 'calibrated', 'signed_employee', 'signed_manager', 'final', 'final_unsigned'
    ))
);

CREATE INDEX "kpi_scorecard_steps_scorecard_id_idx" ON "kpi_scorecard_steps"("scorecard_id");

ALTER TABLE "kpi_scorecard_steps" ADD CONSTRAINT "kpi_scorecard_steps_scorecard_id_fkey" FOREIGN KEY ("scorecard_id") REFERENCES "kpi_scorecards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kpi_scorecard_steps" ADD CONSTRAINT "kpi_scorecard_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN (
    'leave_waiting', 'leave_decided', 'permission_waiting', 'permission_decided',
    'reimbursement_waiting', 'reimbursement_decided', 'reimbursement_paid',
    'correction_waiting', 'correction_decided',
    'raise_request_waiting', 'pay_raise_waiting', 'pay_raise_decided',
    'payslip_issued', 'home_location_waiting', 'home_location_decided',
    'check_in_reminder', 'check_out_reminder',
    'kpi_self_rating', 'kpi_waiting', 'kpi_ready_to_sign'
));
