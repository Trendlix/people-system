-- The CV fit (owner, 25 October 2026, on the Marketing Manager vacancy's applicants added from Suggested From Earlier
-- CVs, CV match "—" for all: "aren't you supposed to match the candidate to the job based on the CV and ATS?"; asked,
-- they chose "Full CV fit score"; packages/shared cv-fit.ts), and the other open positions a CV fits ("and if it
-- recomended to another position based on the CV"). Written by hand. No notification kind is added.

-- 1. An application's CV fit for its vacancy: its percent, version and parts (key skills, title, experience,
--    requirements, education) beside cv_match_percent, which holds the fit's percent from now on (the sort, the
--    "CV match" filter and the lists keep reading it). The fits of before are worked out by the recruitment round (an
--    application whose CV is read and whose fit is missing or of an older version), so nothing is filled in here.
ALTER TABLE "job_applications" ADD COLUMN "cv_fit" JSONB;
ALTER TABLE "job_applications"
  ADD CONSTRAINT "job_applications_cv_fit_check" CHECK ("cv_fit" IS NULL OR jsonb_typeof("cv_fit") = 'object');

-- 2. An earlier CV's fit for an open vacancy (the person's side of Suggested From Earlier CVs): one a CV (an application,
--    or a general CV) a vacancy, 50% or more, worked out with the vacancy's suggestions (on its page opening, its approval
--    or reopening, a change of what it is scored by, a round of the CV readings, the hourly round). Its percent apart,
--    so the lists sort by it. The vacancy's, the application's or the general CV's go with it.
CREATE TABLE "cv_open_fits" (
    "id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "application_id" UUID,
    "general_cv_id" UUID,
    "percent" INTEGER NOT NULL,
    "fit" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cv_open_fits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cv_open_fits_record_check" CHECK (num_nonnulls("application_id", "general_cv_id") = 1),
    CONSTRAINT "cv_open_fits_percent_check" CHECK ("percent" BETWEEN 0 AND 100),
    CONSTRAINT "cv_open_fits_fit_check" CHECK (jsonb_typeof("fit") = 'object')
);

CREATE UNIQUE INDEX "cv_open_fits_vacancy_id_application_id_key" ON "cv_open_fits"("vacancy_id", "application_id");
CREATE UNIQUE INDEX "cv_open_fits_vacancy_id_general_cv_id_key" ON "cv_open_fits"("vacancy_id", "general_cv_id");
CREATE INDEX "cv_open_fits_application_id_idx" ON "cv_open_fits"("application_id");
CREATE INDEX "cv_open_fits_general_cv_id_idx" ON "cv_open_fits"("general_cv_id");

ALTER TABLE "cv_open_fits" ADD CONSTRAINT "cv_open_fits_vacancy_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cv_open_fits" ADD CONSTRAINT "cv_open_fits_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cv_open_fits" ADD CONSTRAINT "cv_open_fits_general_cv_id_fkey" FOREIGN KEY ("general_cv_id") REFERENCES "general_cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
