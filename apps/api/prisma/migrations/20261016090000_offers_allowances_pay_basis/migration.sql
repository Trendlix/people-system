-- Job offers, allowances, and pay by the hour (owner's requests, 15 October 2026).
--
-- Contracts: every contract is fixed-term (the company has no open-ended contracts). A contract's pay is a monthly
-- salary or by the hour (part-time), when the gross is the monthly estimate, hourly rate × hours a week × 52 ÷ 12;
-- days_per_week is the working days a week (2, 3 … for part-time), empty for the shift's own week.
--
-- Allowances: kinds set by HR, each taxed or not and counted in the insured wage or not; a contract version or an offer
-- keeps each allowance's name and treatment as they were when drafted. A cash allowance is taxed by law (Law 91/2005
-- Art. 9), so the one kind added here, Transportation, starts as taxed and not insured; HR can change both.
--
-- Job offers: a candidate is not an employee. The offer holds the person, the position and the terms, its filled
-- document as sent, the link's secret (only its SHA-256) and the answer. Once accepted, the profile, the employment and
-- a draft contract are made from it.

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "days_per_week" INTEGER,
ADD COLUMN     "hourly_rate" DECIMAL(10,2),
ADD COLUMN     "hours_per_week" DECIMAL(4,1),
ADD COLUMN     "pay_basis" TEXT NOT NULL DEFAULT 'monthly';

-- CreateTable
CREATE TABLE "allowance_types" (
    "id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "insured" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "allowance_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_allowances" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "allowance_type_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL,
    "insured" BOOLEAN NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "contract_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_allowances" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "allowance_type_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL,
    "insured" BOOLEAN NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "offer_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offers" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "full_name_en" TEXT NOT NULL,
    "full_name_ar" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT,
    "employee_id" UUID,
    "employment_type" "employment_type" NOT NULL,
    "department_id" UUID,
    "job_title_id" UUID,
    "grade_id" UUID,
    "manager_id" UUID,
    "shift_id" UUID,
    "work_arrangement" "work_arrangement" NOT NULL DEFAULT 'office',
    "office_days" SMALLINT[] DEFAULT ARRAY[]::SMALLINT[],
    "join_date" DATE NOT NULL,
    "pay_basis" TEXT NOT NULL DEFAULT 'monthly',
    "gross_salary" DECIMAL(12,2) NOT NULL,
    "hourly_rate" DECIMAL(10,2),
    "hours_per_week" DECIMAL(4,1),
    "days_per_week" INTEGER,
    "basic_percent" INTEGER NOT NULL DEFAULT 80,
    "net_salary" DECIMAL(12,2),
    "probation_months" INTEGER NOT NULL DEFAULT 3,
    "duration_months" INTEGER NOT NULL DEFAULT 12,
    "expires_on" DATE NOT NULL,
    "message" TEXT,
    "note" TEXT,
    "template_version_id" UUID,
    "document_date" DATE,
    "file_name" TEXT,
    "data" BYTEA,
    "pdf" BYTEA,
    "token_hash" TEXT,
    "sent_via" TEXT,
    "sent_to" TEXT,
    "sent_at" TIMESTAMPTZ,
    "sent_by" UUID,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "viewed_at" TIMESTAMPTZ,
    "responded_at" TIMESTAMPTZ,
    "answered_by" UUID,
    "accepted_name" TEXT,
    "decline_reason" TEXT,
    "response_ip" TEXT,
    "response_agent" TEXT,
    "withdrawn_at" TIMESTAMPTZ,
    "withdraw_reason" TEXT,
    "hired_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allowance_types_name_en_key" ON "allowance_types"("name_en");

-- CreateIndex
CREATE UNIQUE INDEX "contract_allowances_contract_id_allowance_type_id_key" ON "contract_allowances"("contract_id", "allowance_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "offer_allowances_offer_id_allowance_type_id_key" ON "offer_allowances"("offer_id", "allowance_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_offers_number_key" ON "job_offers"("number");

-- CreateIndex
CREATE UNIQUE INDEX "job_offers_token_hash_key" ON "job_offers"("token_hash");

-- CreateIndex
CREATE INDEX "job_offers_status_idx" ON "job_offers"("status");

-- CreateIndex
CREATE INDEX "job_offers_employee_id_idx" ON "job_offers"("employee_id");

-- AddForeignKey
ALTER TABLE "contract_allowances" ADD CONSTRAINT "contract_allowances_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_allowances" ADD CONSTRAINT "contract_allowances_allowance_type_id_fkey" FOREIGN KEY ("allowance_type_id") REFERENCES "allowance_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_allowances" ADD CONSTRAINT "offer_allowances_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_allowances" ADD CONSTRAINT "offer_allowances_allowance_type_id_fkey" FOREIGN KEY ("allowance_type_id") REFERENCES "allowance_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_answered_by_fkey" FOREIGN KEY ("answered_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- the first allowance kind
INSERT INTO "allowance_types" ("id", "name_en", "name_ar", "taxable", "insured", "sort_order", "updated_at")
VALUES ('6f1b3c2e-8d4a-4e5b-9c71-0a2d4e6f8b10', 'Transportation', 'بدل انتقال', true, false, 1, CURRENT_TIMESTAMP);
