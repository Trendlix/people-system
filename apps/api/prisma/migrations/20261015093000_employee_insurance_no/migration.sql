-- The employee's social insurance number (الرقم التأميني), digits only; no two people share one.
ALTER TABLE "employees" ADD COLUMN "insurance_no" TEXT;

CREATE UNIQUE INDEX "employees_insurance_no_key" ON "employees"("insurance_no");
