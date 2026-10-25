-- Leave coverage (owner, 25 October 2026: "if there are leaves applied by an employee and another employee in the same
-- department is on a leave, how can we manage it without affecting the workflow?"; asked, they chose "Warn and need HR",
-- "Required over 2 days", "To a stand-in" and "Names, no leave types"; packages/shared leave-coverage.ts). Written by
-- hand. Two notification kinds are added (leave_cover, stand_in): notifications_kind_check is stated again with every
-- kind of 20261024160000_suggested_cvs, then these; and one WhatsApp template (cover_assigned).

-- 1. A team's staffing limit for annual leave, or a department's without teams: at most so many people on annual (and
--    unpaid) leave at once, and/or at least so many percent at work; at least one of them (no limit: no row). Set by HR
--    and a Super Admin; goes with its team or department.
CREATE TABLE "leave_staffing_limits" (
    "department_id" UUID NOT NULL,
    "max_off" INTEGER,
    "min_at_work_percent" INTEGER,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_staffing_limits_pkey" PRIMARY KEY ("department_id"),
    CONSTRAINT "leave_staffing_limits_max_off_check" CHECK ("max_off" IS NULL OR "max_off" BETWEEN 0 AND 500),
    CONSTRAINT "leave_staffing_limits_min_at_work_percent_check" CHECK ("min_at_work_percent" IS NULL OR "min_at_work_percent" BETWEEN 1 AND 100),
    CONSTRAINT "leave_staffing_limits_some_check" CHECK ("max_off" IS NOT NULL OR "min_at_work_percent" IS NOT NULL)
);

ALTER TABLE "leave_staffing_limits" ADD CONSTRAINT "leave_staffing_limits_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_staffing_limits" ADD CONSTRAINT "leave_staffing_limits_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. A leave request's colleague who covers (required for annual and unpaid leave of more than 2 working days; never the
--    employee) and the employee's handover note to them (free text, at most 1,000 characters); whether it broke the
--    team's staffing limit when sent (HR approves it too, marked "Over the staffing limit"); and an approver's stand-in for
--    its days, a person (never the employee) or HR, never both, with when the stand-in was told it started.
ALTER TABLE "leave_requests"
  ADD COLUMN "cover_id" UUID,
  ADD COLUMN "handover_note" TEXT,
  ADD COLUMN "over_staffing_limit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stand_in_id" UUID,
  ADD COLUMN "stand_in_hr" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stand_in_told_at" TIMESTAMPTZ,
  ADD CONSTRAINT "leave_requests_cover_check" CHECK ("cover_id" IS NULL OR "cover_id" <> "employee_id"),
  ADD CONSTRAINT "leave_requests_handover_note_check" CHECK ("handover_note" IS NULL OR char_length("handover_note") <= 1000),
  ADD CONSTRAINT "leave_requests_stand_in_check" CHECK (NOT ("stand_in_hr" AND "stand_in_id" IS NOT NULL) AND ("stand_in_id" IS NULL OR "stand_in_id" <> "employee_id"));

CREATE INDEX "leave_requests_cover_id_idx" ON "leave_requests"("cover_id");
CREATE INDEX "leave_requests_stand_in_id_idx" ON "leave_requests"("stand_in_id");
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_cover_id_fkey" FOREIGN KEY ("cover_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_stand_in_id_fkey" FOREIGN KEY ("stand_in_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. A step decided by a stand-in keeps the approver they stood in for (the audit log has both too): on leave,
--    permission, work from home, official duty, attendance correction and reimbursement steps.
ALTER TABLE "leave_request_steps" ADD COLUMN "on_behalf_of" UUID;
ALTER TABLE "permission_request_steps" ADD COLUMN "on_behalf_of" UUID;
ALTER TABLE "wfh_request_steps" ADD COLUMN "on_behalf_of" UUID;
ALTER TABLE "od_request_steps" ADD COLUMN "on_behalf_of" UUID;
ALTER TABLE "attendance_correction_steps" ADD COLUMN "on_behalf_of" UUID;
ALTER TABLE "reimbursement_claim_steps" ADD COLUMN "on_behalf_of" UUID;
ALTER TABLE "leave_request_steps" ADD CONSTRAINT "leave_request_steps_on_behalf_of_fkey" FOREIGN KEY ("on_behalf_of") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "permission_request_steps" ADD CONSTRAINT "permission_request_steps_on_behalf_of_fkey" FOREIGN KEY ("on_behalf_of") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wfh_request_steps" ADD CONSTRAINT "wfh_request_steps_on_behalf_of_fkey" FOREIGN KEY ("on_behalf_of") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "od_request_steps" ADD CONSTRAINT "od_request_steps_on_behalf_of_fkey" FOREIGN KEY ("on_behalf_of") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_steps" ADD CONSTRAINT "attendance_correction_steps_on_behalf_of_fkey" FOREIGN KEY ("on_behalf_of") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claim_steps" ADD CONSTRAINT "reimbursement_claim_steps_on_behalf_of_fkey" FOREIGN KEY ("on_behalf_of") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. A leave request's steps: its employee changing the colleague who covers (cover_changed), beside those of before.
ALTER TABLE "leave_request_steps" DROP CONSTRAINT "leave_request_steps_kind_check";
ALTER TABLE "leave_request_steps" ADD CONSTRAINT "leave_request_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled', 'cover_changed'));

-- 5. The notification kinds: every kind of 20261024160000_suggested_cvs, then a colleague named to cover someone's leave
--    (leave_cover) and a stand-in told their step's requests come to them (stand_in).
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
    'stand_in'
));

-- 6. WhatsApp's messages may be the new template too: a colleague named to cover someone's leave (cover_assigned).
ALTER TABLE "whatsapp_messages" DROP CONSTRAINT "whatsapp_messages_template_check";
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_template_check" CHECK ("template" IN (
    'approval_waiting', 'approvals_digest', 'request_update', 'payslip_ready',
    'access_on_hold', 'access_grace', 'access_grace_ending',
    'check_in_reminder', 'check_out_reminder', 'interview_panel',
    'application_received', 'cv_received', 'interview_invitation', 'interview_updated', 'interview_cancelled', 'interview_reminder',
    'test_message', 'stop_confirmation',
    'cover_assigned'
));
