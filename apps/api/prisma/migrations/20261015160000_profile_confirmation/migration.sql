-- The employee's own check of their details (owner's decision, 15 October 2026): an employee confirms their personal,
-- contact, emergency contact and education details once, and again after every change, accepting that they are
-- responsible for what they confirmed. They don't edit the data: they ask for a change, which HR or an Admin approves
-- or rejects.

-- 1. Each confirmation, with the values confirmed (packages/shared CONFIRM_FIELDS; dates as YYYY-MM-DD, empty as null)
-- and the version of the statement accepted (PROFILE_DISCLAIMER). The latest one is up to date while the profile still
-- has those values.
CREATE TABLE "profile_confirmations" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disclaimer_version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "profile_confirmations_pkey" PRIMARY KEY ("id")
);
-- an employee's latest confirmation
CREATE INDEX "profile_confirmations_employee_id_confirmed_at_idx" ON "profile_confirmations"("employee_id", "confirmed_at");
ALTER TABLE "profile_confirmations" ADD CONSTRAINT "profile_confirmations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- who confirmed is part of the record: a sign-in account with confirmations is kept
ALTER TABLE "profile_confirmations" ADD CONSTRAINT "profile_confirmations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. The changes employees ask for: [{ field, from, to }], waiting for HR or an Admin (pending), then approved,
-- rejected or cancelled by the employee. One waits per employee at a time (checked by the API).
CREATE TABLE "profile_change_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changes" JSONB NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,

    CONSTRAINT "profile_change_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profile_change_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'))
);
-- HR's queue (pending) and the other lists by status
CREATE INDEX "profile_change_requests_status_idx" ON "profile_change_requests"("status");
CREATE INDEX "profile_change_requests_employee_id_idx" ON "profile_change_requests"("employee_id");
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
