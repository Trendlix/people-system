-- AlterTable
ALTER TABLE "shifts" ALTER COLUMN "working_days" SET DEFAULT ARRAY[0, 1, 2, 3, 4]::SMALLINT[];

-- CreateTable
CREATE TABLE "company" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "activity" TEXT,
    "commercial_reg_no" TEXT,
    "tax_reg_no" TEXT,
    "insurance_employer_no" TEXT,
    "address_ar" TEXT,
    "address_en" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "rep_name" TEXT,
    "rep_title" TEXT,
    "rep_national_id" CHAR(14),
    "logo" BYTEA,
    "logo_mime_type" TEXT,
    "logo_updated_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);
