-- HR's hold on an employee's access (owner, 1 November 2026: "how can i hold access to any employee", then "build it"):
-- check-in and check-out only, whatever the contract, until HR releases it. Kept after release as the history; one not
-- released a person at most.
CREATE TABLE "access_holds" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "held_by" UUID,
    "held_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by" UUID,
    "released_at" TIMESTAMPTZ,

    CONSTRAINT "access_holds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_holds_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 500)
);

CREATE INDEX "access_holds_employee_id_idx" ON "access_holds"("employee_id");
CREATE UNIQUE INDEX "access_holds_one_open" ON "access_holds"("employee_id") WHERE "released_at" IS NULL;

ALTER TABLE "access_holds" ADD CONSTRAINT "access_holds_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_holds" ADD CONSTRAINT "access_holds_held_by_fkey" FOREIGN KEY ("held_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_holds" ADD CONSTRAINT "access_holds_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
