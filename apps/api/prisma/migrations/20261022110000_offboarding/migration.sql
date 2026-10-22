-- Offboarding (owner, 21 October 2026, with the Employees list: "when an employee resigns or contract ends with no
-- renewal, where will the data be stored? will it be another tab?"; 22 October 2026, the full module: "Former Employees
-- tab, clearance checklist (assets returned, laptop, access), exit interview, rehire eligibility, turnover numbers").
-- The rules: packages/shared offboarding.ts; the module: apps/api/src/offboarding.
--
-- 1. The default clearance checklist, HR's to change, with the five items of the brief.
-- 2. The offboarding cases, one an employment at most.
-- 3. Their clearance items: those cleared by a person, and the two the system ticks (assets, final_settlement).
-- 4. Their exit interviews.
-- 5. When the system closed a leaver's sign-in for an ending (once).
-- 6. The notifications' new kinds (every kind kept).

-- 1.
CREATE TABLE "clearance_defaults" (
    "id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clearance_defaults_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clearance_defaults_owner_check" CHECK ("owner" IN ('hr', 'manager', 'admin', 'finance', 'assets')),
    CONSTRAINT "clearance_defaults_label_check" CHECK (length(btrim("label")) BETWEEN 1 AND 120)
);

CREATE INDEX "clearance_defaults_active_position_idx" ON "clearance_defaults"("active", "position");

ALTER TABLE "clearance_defaults" ADD CONSTRAINT "clearance_defaults_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "clearance_defaults" ("id", "position", "label", "owner", "updated_at") VALUES
    (gen_random_uuid(), 1, 'Work handed over to the manager', 'manager', now()),
    (gen_random_uuid(), 2, 'Access cards and keys returned', 'admin', now()),
    (gen_random_uuid(), 3, 'Email and system accounts disabled', 'admin', now()),
    (gen_random_uuid(), 4, 'Social insurance Form 6 filed', 'hr', now()),
    (gen_random_uuid(), 5, 'Experience certificate issued', 'hr', now());

-- 2.
CREATE TABLE "offboarding_cases" (
    "id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "ending_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "opened_by" UUID,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ,
    "override_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ,
    "cleared_notice_at" TIMESTAMPTZ,
    "rehire" TEXT,
    "rehire_reason" TEXT,
    "rehire_set_by" UUID,
    "rehire_set_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "offboarding_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offboarding_cases_status_check" CHECK ("status" IN ('open', 'completed', 'cancelled')),
    CONSTRAINT "offboarding_cases_completed_check" CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL)),
    CONSTRAINT "offboarding_cases_rehire_check" CHECK ("rehire" IS NULL OR "rehire" IN ('eligible', 'conditional', 'not_eligible')),
    CONSTRAINT "offboarding_cases_rehire_reason_check" CHECK ("rehire_reason" IS NULL OR length("rehire_reason") <= 500),
    CONSTRAINT "offboarding_cases_override_reason_check" CHECK ("override_reason" IS NULL OR length("override_reason") <= 500)
);

CREATE UNIQUE INDEX "offboarding_cases_employment_id_key" ON "offboarding_cases"("employment_id");
CREATE INDEX "offboarding_cases_status_idx" ON "offboarding_cases"("status");
CREATE INDEX "offboarding_cases_ending_id_idx" ON "offboarding_cases"("ending_id");

ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_ending_id_fkey" FOREIGN KEY ("ending_id") REFERENCES "employment_endings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_rehire_set_by_fkey" FOREIGN KEY ("rehire_set_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3.
CREATE TABLE "offboarding_items" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "label" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "done_by" UUID,
    "done_at" TIMESTAMPTZ,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "offboarding_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offboarding_items_kind_check" CHECK ("kind" IN ('manual', 'assets', 'final_settlement')),
    CONSTRAINT "offboarding_items_owner_check" CHECK ("owner" IN ('hr', 'manager', 'admin', 'finance', 'assets')),
    CONSTRAINT "offboarding_items_status_check" CHECK ("status" IN ('pending', 'done', 'not_applicable')),
    CONSTRAINT "offboarding_items_label_check" CHECK (length(btrim("label")) BETWEEN 1 AND 120),
    CONSTRAINT "offboarding_items_note_check" CHECK ("note" IS NULL OR length("note") <= 500),
    -- cleared when, and only when, it is done or not applicable
    CONSTRAINT "offboarding_items_done_check" CHECK (("status" = 'pending') = ("done_at" IS NULL))
);

CREATE UNIQUE INDEX "offboarding_items_case_id_position_key" ON "offboarding_items"("case_id", "position");

ALTER TABLE "offboarding_items" ADD CONSTRAINT "offboarding_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "offboarding_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offboarding_items" ADD CONSTRAINT "offboarding_items_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4.
CREATE TABLE "exit_interviews" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "filled_by" TEXT NOT NULL,
    "reason" TEXT,
    "rating_role" INTEGER,
    "rating_manager" INTEGER,
    "rating_pay" INTEGER,
    "rating_growth" INTEGER,
    "rating_culture" INTEGER,
    "recommend" TEXT,
    "comments" TEXT,
    "declined_note" TEXT,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "exit_interviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exit_interviews_status_check" CHECK ("status" IN ('submitted', 'declined')),
    CONSTRAINT "exit_interviews_filled_by_check" CHECK ("filled_by" IN ('employee', 'hr')),
    CONSTRAINT "exit_interviews_recommend_check" CHECK ("recommend" IS NULL OR "recommend" IN ('yes', 'maybe', 'no')),
    CONSTRAINT "exit_interviews_ratings_check" CHECK (
        ("rating_role" IS NULL OR "rating_role" BETWEEN 1 AND 5) AND
        ("rating_manager" IS NULL OR "rating_manager" BETWEEN 1 AND 5) AND
        ("rating_pay" IS NULL OR "rating_pay" BETWEEN 1 AND 5) AND
        ("rating_growth" IS NULL OR "rating_growth" BETWEEN 1 AND 5) AND
        ("rating_culture" IS NULL OR "rating_culture" BETWEEN 1 AND 5)
    ),
    -- a sent one has its answers
    CONSTRAINT "exit_interviews_answers_check" CHECK ("status" <> 'submitted' OR ("reason" IS NOT NULL AND "recommend" IS NOT NULL AND "rating_role" IS NOT NULL AND "rating_manager" IS NOT NULL AND "rating_pay" IS NOT NULL AND "rating_growth" IS NOT NULL AND "rating_culture" IS NOT NULL)),
    CONSTRAINT "exit_interviews_comments_check" CHECK ("comments" IS NULL OR length("comments") <= 2000),
    CONSTRAINT "exit_interviews_declined_note_check" CHECK ("declined_note" IS NULL OR length("declined_note") <= 500)
);

CREATE UNIQUE INDEX "exit_interviews_case_id_key" ON "exit_interviews"("case_id");

ALTER TABLE "exit_interviews" ADD CONSTRAINT "exit_interviews_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "offboarding_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exit_interviews" ADD CONSTRAINT "exit_interviews_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5.
ALTER TABLE "employments" ADD COLUMN "sign_in_closed_at" TIMESTAMPTZ;

-- 6.
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
    'offboarding_items', 'offboarding_cleared', 'exit_interview'
));
