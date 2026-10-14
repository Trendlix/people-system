-- Profile and employment apart (owner's decision, 14 October 2026): the profile (employees) is kept for good, and each
-- period of employment is a row of its own (employments), so the profile of someone who resigns stays, and someone hired
-- again gets a new employment while the earlier ones stay as their history.

CREATE TABLE "employments" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_type" "employment_type" NOT NULL,
    "status" "employee_status" NOT NULL DEFAULT 'probation',
    "department_id" UUID,
    "job_title_id" UUID,
    "manager_id" UUID,
    "join_date" DATE NOT NULL,
    "probation_end" DATE,
    "work_arrangement" "work_arrangement" NOT NULL DEFAULT 'office',
    "office_days" SMALLINT[] DEFAULT ARRAY[]::SMALLINT[],
    "shift_id" UUID,
    "jd_acknowledged_at" DATE,
    "end_date" DATE,
    "end_reason" TEXT,
    "end_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employments_employee_id_idx" ON "employments"("employee_id");
CREATE INDEX "employments_department_id_idx" ON "employments"("department_id");
CREATE INDEX "employments_job_title_id_idx" ON "employments"("job_title_id");
CREATE INDEX "employments_manager_id_idx" ON "employments"("manager_id");
ALTER TABLE "employments" ADD CONSTRAINT "employments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employments" ADD CONSTRAINT "employments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employments" ADD CONSTRAINT "employments_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employments" ADD CONSTRAINT "employments_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employments" ADD CONSTRAINT "employments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every employee's employment so far becomes their first employment. Someone already marked Resigned or Terminated
-- gets an end on the day their record was last changed, the closest date known.
INSERT INTO "employments" (
    "id", "employee_id", "employment_type", "status", "department_id", "job_title_id", "manager_id", "join_date",
    "probation_end", "work_arrangement", "office_days", "shift_id", "jd_acknowledged_at", "end_date", "end_reason",
    "created_at", "updated_at"
)
SELECT
    gen_random_uuid(), "id", "employment_type", "status", "department_id", "job_title_id", "manager_id", "join_date",
    "probation_end", "work_arrangement", "office_days", "shift_id", "jd_acknowledged_at",
    CASE WHEN "status" IN ('resigned', 'terminated') THEN ("updated_at" AT TIME ZONE 'Africa/Cairo')::date END,
    CASE WHEN "status" IN ('resigned', 'terminated') THEN "status"::text END,
    "created_at", "updated_at"
FROM "employees";

-- The profile keeps no employment of its own any more.
ALTER TABLE "employees" DROP CONSTRAINT "employees_department_id_fkey";
ALTER TABLE "employees" DROP CONSTRAINT "employees_job_title_id_fkey";
ALTER TABLE "employees" DROP CONSTRAINT "employees_manager_id_fkey";
ALTER TABLE "employees" DROP CONSTRAINT "employees_shift_id_fkey";
DROP INDEX "employees_department_id_idx";
DROP INDEX "employees_job_title_id_idx";
DROP INDEX "employees_manager_id_idx";
ALTER TABLE "employees"
    DROP COLUMN "department_id",
    DROP COLUMN "employment_type",
    DROP COLUMN "jd_acknowledged_at",
    DROP COLUMN "job_title_id",
    DROP COLUMN "join_date",
    DROP COLUMN "manager_id",
    DROP COLUMN "office_days",
    DROP COLUMN "probation_end",
    DROP COLUMN "shift_id",
    DROP COLUMN "status",
    DROP COLUMN "work_arrangement";

-- Papers in the employee file: the number printed on them and when they expire, when they do.
ALTER TABLE "paperwork_items" ADD COLUMN "document_no" TEXT, ADD COLUMN "expires_on" DATE;
