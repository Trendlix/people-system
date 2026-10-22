-- Candidate profiles (owner, 22 October 2026: "how to make like a profile for each candidate to store history and
-- prevent duplication? even if the same candidate applied for 2 jobs"; asked, "Email or mobile" and "Link and show
-- rehire"; then "and their is a possible match from other fields, HR decides from suggested match"; packages/shared
-- candidates.ts). One profile per person, CAN-0001, holding every application, general CV, CV, interview and offer.
--
-- 1. The candidates: their code in its own series, the latest name and links, the employee they are, the profile they
--    were merged into, when they last applied.
-- 2. Their emails and mobiles, as compared: one email or mobile belongs to one candidate.
-- 3. What they are compared by for the suggested matches (derived, worked out again by the API).
-- 4. The possible matches (duplicates and suggestions) and HR's decision on each pair; the merges, kept to be undone.
-- 5. The candidate of each application and general CV: nullable, as the applications and general CVs already here get
--    theirs from the API's backfill (it normalizes their mobiles with the system's phone rule, which SQL can't), run
--    once on deploy under an advisory lock; every new one gets it in its own transaction.
-- 6. Each CV file's SHA-256, worked out by the database (a generated column) for the "same CV file" suggestion; the
--    CVs already here get theirs as the column is added.

-- 1.
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "linkedin" TEXT,
    "portfolio" TEXT,
    "employee_id" UUID,
    "merged_into_id" UUID,
    "merged_at" TIMESTAMPTZ,
    "last_applied_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidates_code_check" CHECK ("code" ~ '^CAN-[0-9]{4,}$'),
    CONSTRAINT "candidates_not_into_itself_check" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id")
);

CREATE UNIQUE INDEX "candidates_code_key" ON "candidates"("code");
CREATE INDEX "candidates_merged_into_id_idx" ON "candidates"("merged_into_id");
CREATE INDEX "candidates_employee_id_idx" ON "candidates"("employee_id");
CREATE INDEX "candidates_last_applied_at_idx" ON "candidates"("last_applied_at");

ALTER TABLE "candidates" ADD CONSTRAINT "candidates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2.
CREATE TABLE "candidate_contacts" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidate_contacts_kind_check" CHECK ("kind" IN ('email', 'mobile')),
    CONSTRAINT "candidate_contacts_value_check" CHECK (
        ("kind" = 'email' AND "value" = lower(btrim("value")) AND "value" LIKE '%_@_%')
        OR ("kind" = 'mobile' AND "value" ~ '^\+[0-9]{8,15}$')
    )
);

CREATE UNIQUE INDEX "candidate_contacts_kind_value_key" ON "candidate_contacts"("kind", "value");
CREATE INDEX "candidate_contacts_candidate_id_idx" ON "candidate_contacts"("candidate_id");

ALTER TABLE "candidate_contacts" ADD CONSTRAINT "candidate_contacts_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3.
CREATE TABLE "candidate_keys" (
    "candidate_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "candidate_keys_pkey" PRIMARY KEY ("candidate_id", "kind", "value"),
    CONSTRAINT "candidate_keys_kind_check" CHECK ("kind" IN ('email', 'mobile', 'email_fixed', 'email_local', 'mobile_tail', 'linkedin', 'portfolio', 'cv', 'name', 'cv_email', 'cv_phone'))
);

CREATE INDEX "candidate_keys_value_idx" ON "candidate_keys"("value");

ALTER TABLE "candidate_keys" ADD CONSTRAINT "candidate_keys_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4.
CREATE TABLE "candidate_matches" (
    "id" UUID NOT NULL,
    "candidate_a_id" UUID NOT NULL,
    "candidate_b_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_matches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidate_matches_order_check" CHECK ("candidate_a_id" < "candidate_b_id"),
    CONSTRAINT "candidate_matches_kind_check" CHECK ("kind" IN ('duplicate', 'suggested')),
    CONSTRAINT "candidate_matches_status_check" CHECK ("status" IN ('open', 'dismissed', 'merged')),
    CONSTRAINT "candidate_matches_score_check" CHECK ("score" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "candidate_matches_candidate_a_id_candidate_b_id_key" ON "candidate_matches"("candidate_a_id", "candidate_b_id");
CREATE INDEX "candidate_matches_candidate_b_id_idx" ON "candidate_matches"("candidate_b_id");
CREATE INDEX "candidate_matches_status_idx" ON "candidate_matches"("status");

ALTER TABLE "candidate_matches" ADD CONSTRAINT "candidate_matches_candidate_a_id_fkey" FOREIGN KEY ("candidate_a_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_matches" ADD CONSTRAINT "candidate_matches_candidate_b_id_fkey" FOREIGN KEY ("candidate_b_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_matches" ADD CONSTRAINT "candidate_matches_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "candidate_merges" (
    "id" UUID NOT NULL,
    "kept_id" UUID NOT NULL,
    "merged_id" UUID NOT NULL,
    "moved" JSONB NOT NULL,
    "by_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMPTZ,
    "undone_by" UUID,

    CONSTRAINT "candidate_merges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidate_merges_two_check" CHECK ("kept_id" <> "merged_id"),
    CONSTRAINT "candidate_merges_moved_check" CHECK (jsonb_typeof("moved") = 'object')
);

CREATE INDEX "candidate_merges_kept_id_at_idx" ON "candidate_merges"("kept_id", "at");
CREATE INDEX "candidate_merges_merged_id_idx" ON "candidate_merges"("merged_id");

ALTER TABLE "candidate_merges" ADD CONSTRAINT "candidate_merges_kept_id_fkey" FOREIGN KEY ("kept_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_merges" ADD CONSTRAINT "candidate_merges_merged_id_fkey" FOREIGN KEY ("merged_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_merges" ADD CONSTRAINT "candidate_merges_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "candidate_merges" ADD CONSTRAINT "candidate_merges_undone_by_fkey" FOREIGN KEY ("undone_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5.
ALTER TABLE "job_applications" ADD COLUMN "candidate_id" UUID;
CREATE INDEX "job_applications_candidate_id_idx" ON "job_applications"("candidate_id");
CREATE INDEX "job_applications_vacancy_id_candidate_id_idx" ON "job_applications"("vacancy_id", "candidate_id");
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "general_cvs" ADD COLUMN "candidate_id" UUID;
CREATE INDEX "general_cvs_candidate_id_created_at_idx" ON "general_cvs"("candidate_id", "created_at");
ALTER TABLE "general_cvs" ADD CONSTRAINT "general_cvs_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6.
ALTER TABLE "job_application_cvs" ADD COLUMN "sha256" TEXT GENERATED ALWAYS AS (encode(sha256("data"), 'hex')) STORED;
ALTER TABLE "general_cv_files" ADD COLUMN "sha256" TEXT GENERATED ALWAYS AS (encode(sha256("data"), 'hex')) STORED;
