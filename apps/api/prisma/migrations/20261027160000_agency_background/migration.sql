-- Marketing agency background (owner, 27 October 2026: "i need a flag if the candidate is ex marketing agencies or not
-- AND reflectin the scoring"; he chose "Name words + your list", "Set per job", "Yes or no").

-- what a vacancy asks of it in its CV fit: required, preferred (the default) or not needed
ALTER TABLE "vacancies" ADD COLUMN "agency_background" TEXT NOT NULL DEFAULT 'preferred';
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_agency_background_check" CHECK ("agency_background" IN ('required', 'preferred', 'not_needed'));

-- the companies HR marked a marketing agency, or not one, by their names as compared
CREATE TABLE "agency_marks" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agency" BOOLEAN NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "agency_marks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agency_marks_key_check" CHECK (length(btrim("key")) > 0)
);
CREATE UNIQUE INDEX "agency_marks_key_key" ON "agency_marks"("key");
ALTER TABLE "agency_marks" ADD CONSTRAINT "agency_marks_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
