-- Leave (owner, 18 October 2026: "if we will work on the attendance and leaves, how will we build it?", leave first, as
-- attendance needs leave to tell an absence from a leave; "can you apply the leaves according to the law?"; on unused
-- leave: "make it with decision with the year closing"). The leave types of Labour Law No. 14 of 2025 (Arts. 54–57 and
-- 124–133) as the default types, which HR may change, turn off or add to; requests decided by the direct manager, then
-- HR (no manager: straight to HR), every step logged; the annual balance by calendar year, a joiner's first year
-- pro-rated (Art. 124); a Year Closing where HR decides per employee how many unused days carry into the new year and how
-- many are paid, as the law forbids losing leave (Art. 125); the unused balance paid on leaving. New tables and columns
-- only, besides the Unused leave paid addition type; nothing that is there changes. The rules: packages/shared leaves.ts.

-- The profile: service with earlier employers (Art. 124: 30 days "لمن أمضى عشر سنوات كاملة لدى صاحب عمل أو أكثر"), and a
-- disability (45 days "للأشخاص ذوى الإعاقة والأقزام"); the employment: hazardous or unhealthy work, or work in a remote
-- area (7 days more "للعمال الذين يعملون فى الأعمال الخطرة، أو المضرة بالصحة، أو فى المناطق النائية").
ALTER TABLE "employees" ADD COLUMN "prior_service_months" INTEGER,
ADD COLUMN "disability" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "employees" ADD CONSTRAINT "employees_prior_service_months_check" CHECK ("prior_service_months" IS NULL OR "prior_service_months" BETWEEN 0 AND 600);

ALTER TABLE "employments" ADD COLUMN "hazardous_work" BOOLEAN NOT NULL DEFAULT false;

-- A leave type: the law's, by key, or HR's own (custom-…); its pay (a partly paid type's percent 0–100, only it has one),
-- what its days count against, its limits (each more than 0, the notice and the months of service 0 or more), a document
-- needed, for one gender, counted in calendar days, half days allowed.
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "paid" TEXT NOT NULL,
    "pay_percent" DECIMAL(5,2),
    "balance" TEXT NOT NULL,
    "days_per_year" INTEGER,
    "max_per_request" INTEGER,
    "max_times_in_service" INTEGER,
    "min_service_months" INTEGER,
    "notice_days" INTEGER,
    "document_required" BOOLEAN NOT NULL DEFAULT false,
    "gender" TEXT,
    "calendar_days" BOOLEAN NOT NULL DEFAULT false,
    "half_days" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_types_names_check" CHECK (btrim("name_en") <> '' AND btrim("name_ar") <> ''),
    CONSTRAINT "leave_types_kind_check" CHECK ("kind" IN ('annual', 'casual', 'birth', 'exam', 'hajj', 'sick', 'maternity', 'childcare', 'unpaid', 'custom')),
    CONSTRAINT "leave_types_paid_check" CHECK (
        "paid" IN ('paid', 'unpaid', 'partly')
        AND ("paid" = 'partly') = ("pay_percent" IS NOT NULL)
        AND ("pay_percent" IS NULL OR "pay_percent" BETWEEN 0 AND 100)
    ),
    CONSTRAINT "leave_types_balance_check" CHECK ("balance" IN ('annual', 'from_annual', 'yearly', 'per_request', 'none')),
    CONSTRAINT "leave_types_limits_check" CHECK (
        ("days_per_year" IS NULL OR "days_per_year" BETWEEN 1 AND 366)
        AND ("max_per_request" IS NULL OR "max_per_request" BETWEEN 1 AND 1000)
        AND ("max_times_in_service" IS NULL OR "max_times_in_service" BETWEEN 1 AND 100)
        AND ("min_service_months" IS NULL OR "min_service_months" BETWEEN 0 AND 600)
        AND ("notice_days" IS NULL OR "notice_days" BETWEEN 0 AND 365)
    ),
    CONSTRAINT "leave_types_gender_check" CHECK ("gender" IS NULL OR "gender" IN ('male', 'female'))
);
CREATE UNIQUE INDEX "leave_types_key_key" ON "leave_types"("key");

-- The Leave Setup: the annual leave's days (Art. 124) and how long unused days may be carried (Art. 125).
CREATE TABLE "leave_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "first_year_days" INTEGER NOT NULL DEFAULT 15,
    "standard_days" INTEGER NOT NULL DEFAULT 21,
    "long_service_days" INTEGER NOT NULL DEFAULT 30,
    "long_service_years" INTEGER NOT NULL DEFAULT 10,
    "long_service_age" INTEGER NOT NULL DEFAULT 50,
    "disability_days" INTEGER NOT NULL DEFAULT 45,
    "hazardous_extra_days" INTEGER NOT NULL DEFAULT 7,
    "first_year_min_months" INTEGER NOT NULL DEFAULT 6,
    "settle_within_years" INTEGER NOT NULL DEFAULT 3,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "leave_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_settings_one_row_check" CHECK ("id" = 1),
    CONSTRAINT "leave_settings_days_check" CHECK (
        "first_year_days" BETWEEN 0 AND 366 AND "standard_days" BETWEEN 0 AND 366 AND "long_service_days" BETWEEN 0 AND 366
        AND "disability_days" BETWEEN 0 AND 366 AND "hazardous_extra_days" BETWEEN 0 AND 366
        AND "long_service_years" BETWEEN 1 AND 60 AND "long_service_age" BETWEEN 18 AND 100
        AND "first_year_min_months" BETWEEN 0 AND 12 AND "settle_within_years" BETWEEN 1 AND 10
    )
);

-- A request: the first day no later than the last, its days more than 0 in whole or half days, a half day for one day,
-- where it is (with the manager: one is set), rejected at a stage with its reason.
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "half_day" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "manager_id" UUID,
    "rejected_stage" TEXT,
    "reject_reason" TEXT,
    "recorded_by_hr" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_requests_dates_check" CHECK ("start_date" <= "end_date" AND (NOT "half_day" OR "start_date" = "end_date")),
    CONSTRAINT "leave_requests_days_check" CHECK ("days" > 0 AND "days" * 2 = round("days" * 2)),
    CONSTRAINT "leave_requests_status_check" CHECK ("status" IN ('with_manager', 'with_hr', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT "leave_requests_manager_check" CHECK ("status" <> 'with_manager' OR "manager_id" IS NOT NULL),
    CONSTRAINT "leave_requests_rejected_check" CHECK (
        ("status" = 'rejected') = ("rejected_stage" IS NOT NULL)
        AND ("rejected_stage" IS NULL OR "rejected_stage" IN ('manager', 'hr'))
    )
);

-- Each step of a request, in the order taken; the stages' decisions, and only they, have their decision.
CREATE TABLE "leave_request_steps" (
    "id" BIGSERIAL NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT,
    "comment" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_request_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_request_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled')),
    CONSTRAINT "leave_request_steps_decision_check" CHECK (
        ("decision" IS NOT NULL) = ("kind" IN ('manager_decision', 'hr_decision'))
        AND ("decision" IS NULL OR "decision" IN ('approve', 'reject'))
    )
);

-- A request's documents: photos or PDFs, kept in the database like the employee file.
CREATE TABLE "leave_documents" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_documents_mime_type_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    CONSTRAINT "leave_documents_size_check" CHECK ("size_bytes" > 0)
);

-- An employment's annual leave for a year: the days carried in (by the year each was earned in), and how it was closed:
-- at the Year Closing (unused = carried out + paid out) or on leaving (all paid out); the day rate it was paid at.
CREATE TABLE "leave_balance_years" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "carried_in" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "carried_in_by_year" JSONB NOT NULL DEFAULT '{}',
    "closed_at" TIMESTAMPTZ,
    "closed_by" UUID,
    "closed_on" TEXT,
    "unused" DECIMAL(5,1),
    "carried_out" DECIMAL(5,1),
    "paid_out" DECIMAL(5,1),
    "day_rate" DECIMAL(12,2),
    "payout_adjustment_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leave_balance_years_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_balance_years_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
    CONSTRAINT "leave_balance_years_closed_check" CHECK (
        ("closed_at" IS NULL) = ("closed_on" IS NULL)
        AND ("closed_on" IS NULL OR ("closed_on" IN ('year_closing', 'leaving') AND "unused" IS NOT NULL AND "carried_out" IS NOT NULL AND "paid_out" IS NOT NULL))
        AND ("paid_out" IS NULL OR "paid_out" >= 0)
        AND ("closed_on" IS DISTINCT FROM 'leaving' OR "carried_out" = 0)
        AND ("unused" IS NULL OR "unused" < 0 OR "unused" = "carried_out" + "paid_out")
    )
);

-- HR's change to an annual leave balance: days more or fewer, never 0, in whole or half days, and why.
CREATE TABLE "leave_adjustments" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_adjustments_days_check" CHECK ("days" <> 0 AND "days" * 2 = round("days" * 2)),
    CONSTRAINT "leave_adjustments_reason_check" CHECK (btrim("reason") <> '')
);

-- A year whose balances HR closed.
CREATE TABLE "leave_year_closings" (
    "year" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" UUID,

    CONSTRAINT "leave_year_closings_pkey" PRIMARY KEY ("year")
);

CREATE INDEX "leave_requests_employee_id_start_date_idx" ON "leave_requests"("employee_id", "start_date");
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");
CREATE INDEX "leave_requests_manager_id_idx" ON "leave_requests"("manager_id");
CREATE INDEX "leave_requests_type_id_idx" ON "leave_requests"("type_id");
CREATE INDEX "leave_request_steps_request_id_idx" ON "leave_request_steps"("request_id");
CREATE INDEX "leave_documents_request_id_idx" ON "leave_documents"("request_id");
CREATE UNIQUE INDEX "leave_balance_years_payout_adjustment_id_key" ON "leave_balance_years"("payout_adjustment_id");
CREATE INDEX "leave_balance_years_employee_id_idx" ON "leave_balance_years"("employee_id");
CREATE UNIQUE INDEX "leave_balance_years_employment_id_year_key" ON "leave_balance_years"("employment_id", "year");
CREATE INDEX "leave_adjustments_employment_id_year_idx" ON "leave_adjustments"("employment_id", "year");

ALTER TABLE "leave_settings" ADD CONSTRAINT "leave_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_request_steps" ADD CONSTRAINT "leave_request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_request_steps" ADD CONSTRAINT "leave_request_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_documents" ADD CONSTRAINT "leave_documents_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_balance_years" ADD CONSTRAINT "leave_balance_years_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_balance_years" ADD CONSTRAINT "leave_balance_years_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_balance_years" ADD CONSTRAINT "leave_balance_years_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_balance_years" ADD CONSTRAINT "leave_balance_years_payout_adjustment_id_fkey" FOREIGN KEY ("payout_adjustment_id") REFERENCES "payroll_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_year_closings" ADD CONSTRAINT "leave_year_closings_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The Unused leave paid addition (مقابل رصيد الإجازات): what a Year Closing pays of the unused days, in January of the
-- next year (or the next open month), and what is paid on leaving; taxed, as pay. The types of each kind as before, with it.
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT IF EXISTS "payroll_adjustments_type_check";
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_type_check" CHECK (
    ("kind" = 'addition' AND "type" IN ('bonus', 'bonus_days', 'commission', 'incentive', 'correction', 'reimbursement', 'leave_payout', 'other') AND ("type" NOT IN ('bonus_days', 'leave_payout') OR "taxed"))
    OR ("kind" = 'deduction' AND "type" IN ('penalty', 'penalty_days', 'correction', 'damage_loss', 'advance_recovery', 'loan_installment', 'recurring', 'other') AND NOT "taxed")
);

-- The law's leave types (packages/shared LAW_LEAVE_TYPES), as the default types: the annual leave (Arts. 124–125,
-- working days, the days by the Leave Setup), casual (Art. 128: 7 a year, 2 at a time, from the annual balance), sick
-- (Art. 131: as the medical authority sets, a document, its pay by Social Insurance Law 148/2019, 100% until HR sets
-- it), the birth of a child (Art. 128: the day, 3 times in service, for the father), exams (Art. 126: the exam days, 10
-- days' notice, proof), maternity (Art. 54: four months, 120 calendar days, 3 times, a medical certificate), Hajj or a
-- visit to Jerusalem (Art. 130: a month, 30 calendar days, once, after 5 continuous years), childcare (Art. 57: unpaid,
-- up to two years, 3 times, after a year's service; only for a company of 50 or more, so off) and unpaid leave.
INSERT INTO "leave_types" ("id", "key", "kind", "name_en", "name_ar", "paid", "pay_percent", "balance", "days_per_year", "max_per_request", "max_times_in_service", "min_service_months", "notice_days", "document_required", "gender", "calendar_days", "half_days", "active", "sort_order", "updated_at") VALUES
    (gen_random_uuid(), 'annual', 'annual', 'Annual leave', 'إجازة سنوية', 'paid', NULL, 'annual', NULL, NULL, NULL, NULL, NULL, false, NULL, false, true, true, 1, now()),
    (gen_random_uuid(), 'casual', 'casual', 'Casual leave', 'إجازة عارضة', 'paid', NULL, 'from_annual', 7, 2, NULL, NULL, NULL, false, NULL, false, true, true, 2, now()),
    (gen_random_uuid(), 'sick', 'sick', 'Sick leave', 'إجازة مرضية', 'partly', 100, 'none', NULL, NULL, NULL, NULL, NULL, true, NULL, false, false, true, 3, now()),
    (gen_random_uuid(), 'birth', 'birth', 'Birth of a child', 'إجازة مولود', 'paid', NULL, 'per_request', NULL, 1, 3, NULL, NULL, false, 'male', false, false, true, 4, now()),
    (gen_random_uuid(), 'exam', 'exam', 'Exam leave', 'إجازة امتحانات', 'paid', NULL, 'none', NULL, NULL, NULL, NULL, 10, true, NULL, false, false, true, 5, now()),
    (gen_random_uuid(), 'maternity', 'maternity', 'Maternity leave', 'إجازة وضع', 'paid', NULL, 'per_request', NULL, 120, 3, NULL, NULL, true, 'female', true, false, true, 6, now()),
    (gen_random_uuid(), 'hajj', 'hajj', 'Hajj or Jerusalem visit', 'إجازة الحج أو زيارة بيت المقدس', 'paid', NULL, 'per_request', NULL, 30, 1, 60, NULL, false, NULL, true, false, true, 7, now()),
    (gen_random_uuid(), 'childcare', 'childcare', 'Childcare leave', 'إجازة رعاية طفل', 'unpaid', NULL, 'per_request', NULL, 730, 3, 12, NULL, false, 'female', true, false, false, 8, now()),
    (gen_random_uuid(), 'unpaid', 'unpaid', 'Unpaid leave', 'إجازة بدون أجر', 'unpaid', NULL, 'none', NULL, NULL, NULL, NULL, NULL, false, NULL, false, true, true, 9, now());

-- The Leave Setup with the law's numbers (Arts. 124–125).
INSERT INTO "leave_settings" ("id", "updated_at") VALUES (1, now());
