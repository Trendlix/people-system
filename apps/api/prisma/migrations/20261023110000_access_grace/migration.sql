-- Access follows the contract (owner, 23 October 2026, on the Access tab showing "Active · Has access without an active
-- contract": "No Access without active contract, Access should be on hold with a 7 days grace period one time granted by
-- the hr", then "Active - Grace - Hold - No Access"). Asked, they chose: on Hold "Check-in/out only"; Grace "Once per
-- contract gap"; at go-live "Hold them immediately". The standing of each request is read from the contract (nothing to
-- fill here): on deploy everyone without a contract in force is on Hold at once, and the sweep's first run records it.

-- The standing the sweep recorded last, and since when (packages/shared ACCESS_STANDINGS; none: not recorded yet), so
-- each change is audited and told once.
ALTER TABLE "employees" ADD COLUMN "access_standing" TEXT;
ALTER TABLE "employees" ADD COLUMN "access_standing_at" TIMESTAMPTZ;
ALTER TABLE "employees" ADD CONSTRAINT "employees_access_standing_check" CHECK ("access_standing" IN ('active', 'grace', 'hold', 'no_access'));

-- A 7 days' grace given by HR to someone on Hold: full access to the end of `until` (Cairo time). Its gap is the
-- contract version whose end opened it: one grace a gap, never extended.
CREATE TABLE "access_graces" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "until" DATE NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminded_at" TIMESTAMPTZ,

    CONSTRAINT "access_graces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "access_graces_employee_id_contract_id_key" ON "access_graces"("employee_id", "contract_id");
CREATE INDEX "access_graces_until_idx" ON "access_graces"("until");

ALTER TABLE "access_graces" ADD CONSTRAINT "access_graces_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_graces" ADD CONSTRAINT "access_graces_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_graces" ADD CONSTRAINT "access_graces_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The notices (packages/shared notifications.ts): the employee's access on hold, grace given, grace ending tomorrow; HR
-- told someone went on hold. Every kind kept.
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
    'access_hold', 'access_grace', 'access_grace_ending', 'access_held'
));
