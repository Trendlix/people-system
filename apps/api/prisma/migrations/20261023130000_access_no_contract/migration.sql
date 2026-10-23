-- No contract entered (owner, 23 October 2026, asked about an employee's account switched on whose person never had a
-- signed contract in force: "Hold them after 7 days"). Such an account keeps working for 7 days from the day the sweep
-- first records it (go-live for today's people), with a warning on their Access tab, HR's "No contract entered" on the
-- Employees list and the employee told once; then it is on Hold as the others are, with the one 7 days' grace of it.

-- The day first recorded (Cairo); cleared once a signed contract starts, or they leave.
ALTER TABLE "employees" ADD COLUMN "no_contract_since" DATE;

-- The grace of no contract entered: its gap is the employment with no signed contract (no contract), or, never
-- employed, the person (neither): one a gap, as one a contract's gap.
ALTER TABLE "access_graces" ALTER COLUMN "contract_id" DROP NOT NULL;
ALTER TABLE "access_graces" ADD COLUMN "employment_id" UUID;
ALTER TABLE "access_graces" ADD CONSTRAINT "access_graces_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_graces" ADD CONSTRAINT "access_graces_gap_check" CHECK ("contract_id" IS NULL OR "employment_id" IS NULL);
CREATE UNIQUE INDEX "access_graces_employee_id_employment_id_key" ON "access_graces"("employee_id", "employment_id");
CREATE UNIQUE INDEX "access_graces_never_employed_key" ON "access_graces"("employee_id") WHERE "contract_id" IS NULL AND "employment_id" IS NULL;

-- The notice (packages/shared notifications.ts): the employee told once that their access is on hold from a date unless
-- their contract is entered. Every kind kept: those of 20261023120000_official_duty, then this one.
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
    'access_no_contract'
));
