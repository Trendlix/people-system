-- CreateEnum
CREATE TYPE "employment_type" AS ENUM ('full_time', 'part_time', 'internship', 'freelance', 'sales');

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('active', 'probation', 'on_leave', 'notice_period', 'resigned', 'terminated');

-- CreateEnum
CREATE TYPE "work_arrangement" AS ENUM ('office', 'wfh', 'hybrid');

-- AlterTable
ALTER TABLE "shifts" ALTER COLUMN "working_days" SET DEFAULT ARRAY[0, 1, 2, 3, 4]::SMALLINT[];

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "full_name_en" TEXT NOT NULL,
    "full_name_ar" TEXT NOT NULL,
    "date_of_birth" DATE,
    "gender" TEXT,
    "nationality" TEXT,
    "marital_status" TEXT,
    "military_status" TEXT,
    "work_email" TEXT,
    "personal_email" TEXT,
    "mobile" TEXT,
    "address_ar" TEXT,
    "governorate" TEXT,
    "emergency_name" TEXT,
    "emergency_relation" TEXT,
    "emergency_mobile" TEXT,
    "university" TEXT,
    "faculty" TEXT,
    "degree" TEXT,
    "major" TEXT,
    "graduation_year" SMALLINT,
    "education_grade" TEXT,
    "qualification_ar" TEXT,
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
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_identity" (
    "employee_id" UUID NOT NULL,
    "national_id" CHAR(14),
    "printed_no" TEXT,
    "issue_date" DATE,
    "expiry_date" DATE,
    "issuing_office" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employee_identity_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "employee_bank" (
    "employee_id" UUID NOT NULL,
    "bank_name" TEXT,
    "branch" TEXT,
    "account_no" TEXT,
    "iban" TEXT,
    "holder_name" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employee_bank_pkey" PRIMARY KEY ("employee_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_work_email_key" ON "employees"("work_email");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- CreateIndex
CREATE INDEX "employees_job_title_id_idx" ON "employees"("job_title_id");

-- CreateIndex
CREATE INDEX "employees_manager_id_idx" ON "employees"("manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_identity_national_id_key" ON "employee_identity"("national_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_identity" ADD CONSTRAINT "employee_identity_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_bank" ADD CONSTRAINT "employee_bank_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
