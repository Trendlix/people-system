-- The careers forms filled in from the CV, "Fill in with LinkedIn" and a portfolio per position (owner, 25 October 2026,
-- on "Apply for This Job": "can i use linkedin to complete the data? and for creatives, they need to add their
-- portfolios. so based on the positions i have, what kind of portfolios i might need to ask them for?"; asked, they
-- chose all three; packages/shared cv-contacts.ts, linkedin-signin.ts, portfolio.ts). Written by hand. Filling in from
-- the CV keeps nothing, so it has no table. No notification kind is added.

-- 1. An application's and a general CV's portfolio links (at most 3, in the order sent: the existing "portfolio" stays
--    their first, for older code and pages, and the links of before become each one's list), and "Confirmed by
--    LinkedIn": the email LinkedIn gave, verified, the one sent ('linkedin'; none otherwise).
ALTER TABLE "job_applications"
  ADD COLUMN "portfolio_links" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "email_confirmed_by" TEXT,
  ADD CONSTRAINT "job_applications_portfolio_links_check" CHECK (cardinality("portfolio_links") <= 3),
  ADD CONSTRAINT "job_applications_email_confirmed_by_check" CHECK ("email_confirmed_by" IS NULL OR "email_confirmed_by" = 'linkedin');

ALTER TABLE "general_cvs"
  ADD COLUMN "portfolio_links" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "email_confirmed_by" TEXT,
  ADD CONSTRAINT "general_cvs_portfolio_links_check" CHECK (cardinality("portfolio_links") <= 3),
  ADD CONSTRAINT "general_cvs_email_confirmed_by_check" CHECK ("email_confirmed_by" IS NULL OR "email_confirmed_by" = 'linkedin');

UPDATE "job_applications" SET "portfolio_links" = ARRAY["portfolio"] WHERE "portfolio" IS NOT NULL AND "portfolio" <> '';
UPDATE "general_cvs" SET "portfolio_links" = ARRAY["portfolio"] WHERE "portfolio" IS NOT NULL AND "portfolio" <> '';

-- 2. The PDF case study sent as a portfolio, kept as the CV is (apart, so the lists never read it): a PDF, at most 5 MB,
--    its name cleaned; deleted with its application or general CV.
CREATE TABLE "job_application_portfolios" (
    "application_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_application_portfolios_pkey" PRIMARY KEY ("application_id"),
    CONSTRAINT "job_application_portfolios_file_check" CHECK ("mime_type" = 'application/pdf' AND "size_bytes" BETWEEN 1 AND 5242880)
);

ALTER TABLE "job_application_portfolios" ADD CONSTRAINT "job_application_portfolios_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "general_cv_portfolios" (
    "general_cv_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "general_cv_portfolios_pkey" PRIMARY KEY ("general_cv_id"),
    CONSTRAINT "general_cv_portfolios_file_check" CHECK ("mime_type" = 'application/pdf' AND "size_bytes" BETWEEN 1 AND 5242880)
);

ALTER TABLE "general_cv_portfolios" ADD CONSTRAINT "general_cv_portfolios_general_cv_id_fkey" FOREIGN KEY ("general_cv_id") REFERENCES "general_cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. A vacancy's own say on its form's portfolio ("Portfolio: as the job title / Hidden / Optional / Required"): none
--    is as its job title.
ALTER TABLE "vacancies"
  ADD COLUMN "portfolio_mode" TEXT,
  ADD CONSTRAINT "vacancies_portfolio_mode_check" CHECK ("portfolio_mode" IS NULL OR "portfolio_mode" IN ('hidden', 'optional', 'required'));

-- 4. What HR set for a job title's portfolio (Recruitment Settings, "Portfolio on the Forms"): the mode, a hint (at
--    most 120 characters), the kinds taken and how many links (1 to 3). No row: the default by the rule
--    (portfolioDefaultFor). Deleted with its job title.
CREATE TABLE "portfolio_settings" (
    "job_title_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "hint" TEXT,
    "kinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "max_links" INTEGER NOT NULL DEFAULT 3,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_settings_pkey" PRIMARY KEY ("job_title_id"),
    CONSTRAINT "portfolio_settings_mode_check" CHECK ("mode" IN ('hidden', 'optional', 'required')),
    CONSTRAINT "portfolio_settings_hint_check" CHECK ("hint" IS NULL OR char_length("hint") BETWEEN 1 AND 120),
    CONSTRAINT "portfolio_settings_max_links_check" CHECK ("max_links" BETWEEN 1 AND 3),
    CONSTRAINT "portfolio_settings_kinds_check" CHECK ("kinds" <@ ARRAY['behance', 'dribbble', 'vimeo', 'youtube', 'instagram', 'tiktok', 'github', 'app_store', 'google_play', 'google_drive', 'frame_io', 'figma', 'artstation', 'medium', 'website', 'pdf']::TEXT[]),
    CONSTRAINT "portfolio_settings_asked_check" CHECK ("mode" = 'hidden' OR cardinality("kinds") > 0)
);

ALTER TABLE "portfolio_settings" ADD CONSTRAINT "portfolio_settings_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_settings" ADD CONSTRAINT "portfolio_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. LinkedIn sign-in (one row, id 1; Recruitment Settings, "LinkedIn Sign-in", a Super Admin's): on or off, the app's
--    client ID, its secret sealed (AES-256-GCM, the key from HKDF of JWT_SECRET with info "trendlix-linkedin-v1"; never
--    sent back) with the key's fingerprint beside it, and who saved it last.
CREATE TABLE "linkedin_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "client_id" TEXT,
    "client_secret_enc" TEXT,
    "secret_key_id" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "linkedin_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "linkedin_settings_one_row_check" CHECK ("id" = 1),
    CONSTRAINT "linkedin_settings_client_id_check" CHECK ("client_id" IS NULL OR char_length("client_id") BETWEEN 1 AND 100)
);

ALTER TABLE "linkedin_settings" ADD CONSTRAINT "linkedin_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
