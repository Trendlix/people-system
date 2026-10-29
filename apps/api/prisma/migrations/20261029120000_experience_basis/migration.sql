-- How a vacancy's CV fit counts a CV's years of experience (owner, 29 October 2026: "when calculating expirence in the
-- scoring, make it career based or company based"; he chose "Span vs time employed", "Set per job"): company based (the
-- months worked, the default, as before) or career based (the first job's start to the latest's end, gaps included).
ALTER TABLE "vacancies" ADD COLUMN "experience_basis" TEXT NOT NULL DEFAULT 'company';
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_experience_basis_check" CHECK ("experience_basis" IN ('company', 'career'));
