-- What the social insurance Forms 1 and 6 print that the system didn't hold (owner, 15 October 2026): the company's
-- social insurance office (مكتب التأمينات) and its sector code (قطاع المنشأة, one or two digits as the office gave
-- it); each job title's occupation in the social insurance table (كود المهنة, six digits: packages/shared
-- occupations.ts, checked by the API); and the building number of an employee's address (عقار رقم). All optional.
ALTER TABLE "company" ADD COLUMN "insurance_office" TEXT,
  ADD COLUMN "insurance_sector_code" TEXT,
  ADD CONSTRAINT "company_insurance_office_check" CHECK (char_length("insurance_office") BETWEEN 1 AND 120),
  ADD CONSTRAINT "company_insurance_sector_code_check" CHECK ("insurance_sector_code" ~ '^[0-9]{1,2}$');

ALTER TABLE "job_titles" ADD COLUMN "occupation_code" CHAR(6),
  ADD CONSTRAINT "job_titles_occupation_code_check" CHECK ("occupation_code" ~ '^[0-9]{6}$');

ALTER TABLE "employees" ADD COLUMN "building_no" TEXT,
  ADD CONSTRAINT "employees_building_no_check" CHECK (char_length("building_no") BETWEEN 1 AND 10);
