-- A student on the Education tab (owner, 25 October 2026, on the trainee contract template's {{qualification}}: "if the
-- intern is a student, how will we deal with it? … i am talking about the field mapping"; asked, "Add a Student
-- option"): a "Still studying" switch, with the year (الفرقة) and the expected graduation. While Qualification (Arabic)
-- is empty, contracts print "طالب بالفرقة الثالثة – كلية … – جامعة …" (packages/shared student-education.ts). Everyone
-- so far is not studying.
--
-- The year is one of STUDY_YEARS; the expected graduation a month, kept as its first day; both only while still
-- studying (the API clears them when the switch is turned off).

ALTER TABLE "employees"
  ADD COLUMN "still_studying" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "study_year" TEXT,
  ADD COLUMN "expected_graduation" DATE;

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_study_year_check" CHECK (
    "study_year" IS NULL OR "study_year" IN ('year_1', 'year_2', 'year_3', 'year_4', 'year_5', 'year_6', 'year_7', 'postgraduate_diploma', 'masters', 'phd')
  ),
  ADD CONSTRAINT "employees_expected_graduation_check" CHECK ("expected_graduation" IS NULL OR EXTRACT(DAY FROM "expected_graduation") = 1),
  ADD CONSTRAINT "employees_student_details_check" CHECK ("still_studying" OR ("study_year" IS NULL AND "expected_graduation" IS NULL));
