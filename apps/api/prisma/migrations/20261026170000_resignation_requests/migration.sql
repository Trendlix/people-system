-- An employee asks to resign (owner, 26 October 2026: "but the employee has to request resignation and then the HR
-- generates the document"; packages/shared resignation-request.ts). Written by hand.
--
-- 1. The request: the reason, a preferred last working day and a signed letter (both optional), the day it was sent (the
--    notice received day, Cairo) and the last working day the resignation rule's notice gives from it; withdrawn by the
--    employee until it is recorded, returned by HR with a reason, or recorded as an ending (ending_id). One request
--    waiting (sent) for an employment at a time.
-- 2. Two notification kinds: resignation_new (HR, or the CEO for a C-level person, and the direct manager) and
--    resignation_update (the employee: recorded or returned). notifications_kind_check is stated again with every kind (compensatory days' too, 26 October 2026, so no step ever drops one)
--    of 20261025110000_leave_coverage, the newest migration that defined it, then these two.

-- 1.
CREATE TABLE "resignation_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "preferred_last_day" DATE,
    "sent_on" DATE NOT NULL,
    "notice_amount" INTEGER NOT NULL,
    "notice_unit" TEXT NOT NULL,
    "rule_last_day" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "letter_name" TEXT,
    "letter_mime" TEXT,
    "letter_size" INTEGER,
    "letter_data" BYTEA,
    "withdrawn_at" TIMESTAMPTZ,
    "returned_reason" TEXT,
    "returned_by" UUID,
    "returned_at" TIMESTAMPTZ,
    "ending_id" UUID,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "resignation_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resignation_requests_status_check" CHECK ("status" IN ('sent', 'recorded', 'withdrawn', 'returned')),
    CONSTRAINT "resignation_requests_letter_check" CHECK (
        ("letter_name" IS NULL) = ("letter_mime" IS NULL)
        AND ("letter_name" IS NULL) = ("letter_size" IS NULL)
        AND ("letter_name" IS NULL) = ("letter_data" IS NULL)
    ),
    CONSTRAINT "resignation_requests_returned_check" CHECK (("status" = 'returned') = ("returned_reason" IS NOT NULL)),
    CONSTRAINT "resignation_requests_notice_check" CHECK ("notice_amount" >= 0)
);

CREATE UNIQUE INDEX "resignation_requests_ending_id_key" ON "resignation_requests"("ending_id");
CREATE UNIQUE INDEX "resignation_requests_one_sent" ON "resignation_requests"("employment_id") WHERE "status" = 'sent';
CREATE INDEX "resignation_requests_employee_id_idx" ON "resignation_requests"("employee_id");
CREATE INDEX "resignation_requests_status_idx" ON "resignation_requests"("status");
CREATE INDEX "resignation_requests_employment_id_idx" ON "resignation_requests"("employment_id");

ALTER TABLE "resignation_requests" ADD CONSTRAINT "resignation_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resignation_requests" ADD CONSTRAINT "resignation_requests_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resignation_requests" ADD CONSTRAINT "resignation_requests_returned_by_fkey" FOREIGN KEY ("returned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "resignation_requests" ADD CONSTRAINT "resignation_requests_ending_id_fkey" FOREIGN KEY ("ending_id") REFERENCES "employment_endings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "resignation_requests" ADD CONSTRAINT "resignation_requests_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
    'resignation_new', 'resignation_update'
));
