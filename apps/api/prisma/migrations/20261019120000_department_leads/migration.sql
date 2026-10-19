-- Department heads and team leads (owner, 19 October 2026: "i want to add department lead person, the person in
-- charge"). Asked, the owner chose: one person in charge of each department (its Head of department) and of each team
-- (its Team lead), any current employee, one person may lead several; the default direct manager when someone is hired
-- into it; and, for someone with no direct manager, the approver of their leave requests and reimbursement claims: the
-- team lead, else the head of the department, never the requester themself, else HR as before. The rules: packages/shared
-- department-leads.ts.

-- 1. The person in charge of a department or team: none until HR chooses one; cleared if the profile is deleted.
ALTER TABLE "departments" ADD COLUMN "head_id" UUID;
CREATE INDEX "departments_head_id_idx" ON "departments"("head_id");
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_id_fkey" FOREIGN KEY ("head_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Who decides a request's manager stage, as what: the direct manager, the team lead or the head of the department.
-- Every request and claim sent so far went to the direct manager when it had one.
ALTER TABLE "leave_requests" ADD COLUMN "approver_role" TEXT;
ALTER TABLE "reimbursement_claims" ADD COLUMN "approver_role" TEXT;
UPDATE "leave_requests" SET "approver_role" = 'direct_manager' WHERE "manager_id" IS NOT NULL;
UPDATE "reimbursement_claims" SET "approver_role" = 'direct_manager' WHERE "manager_id" IS NOT NULL;

-- One of the three, set exactly when there is someone deciding the manager stage.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approver_role_check"
    CHECK (("approver_role" IS NULL) = ("manager_id" IS NULL) AND ("approver_role" IS NULL OR "approver_role" IN ('direct_manager', 'team_lead', 'department_head')));
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_approver_role_check"
    CHECK (("approver_role" IS NULL) = ("manager_id" IS NULL) AND ("approver_role" IS NULL OR "approver_role" IN ('direct_manager', 'team_lead', 'department_head')));
