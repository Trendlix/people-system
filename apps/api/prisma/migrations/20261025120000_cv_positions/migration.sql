-- General CVs choose a position, grouped by team, not an area (owner, 25 October 2026, on General CVs' "Area" filter:
-- "what do you mean by area here?", then "should it be the positions?"; asked, they chose "Position, grouped by team";
-- packages/shared cv-positions.ts). Written by hand. No notification kind is added.

-- 1. A general CV's position: its key (its team's id and its merged name, "<team id>:video editor") and its name as shown
--    when it was chosen, or what the person wrote for Other. Its team stays in department_id, so the team filters and the
--    suggestions keep working; an older CV keeps its area (department_id, or area_other) and has no position. Either a
--    position (key and name together) or Other, never both; and a CV says what it is for: a team, an area in words, a
--    position or Other (general_cvs_area_check stated again with the positions).
ALTER TABLE "general_cvs"
  ADD COLUMN "position_key" TEXT,
  ADD COLUMN "position_name" TEXT,
  ADD COLUMN "position_other" TEXT;

ALTER TABLE "general_cvs" DROP CONSTRAINT "general_cvs_area_check";
ALTER TABLE "general_cvs"
  ADD CONSTRAINT "general_cvs_area_check" CHECK ("department_id" IS NOT NULL OR "area_other" IS NOT NULL OR "position_name" IS NOT NULL OR "position_other" IS NOT NULL),
  ADD CONSTRAINT "general_cvs_position_check" CHECK (("position_key" IS NULL) = ("position_name" IS NULL) AND ("position_key" IS NULL OR "position_other" IS NULL)),
  ADD CONSTRAINT "general_cvs_position_lengths_check" CHECK (
    ("position_key" IS NULL OR char_length("position_key") <= 200)
    AND ("position_name" IS NULL OR char_length("position_name") BETWEEN 1 AND 200)
    AND ("position_other" IS NULL OR char_length("position_other") BETWEEN 1 AND 80)
  );

CREATE INDEX "general_cvs_position_key_idx" ON "general_cvs"("position_key");

-- 2. What HR chose for a position in Recruitment Settings ("Positions on the CV Form"), by its key: hidden from the
--    careers page, and a public name (at most 80 characters). No row: shown by its own name, as a new job title's is.
CREATE TABLE "cv_position_choices" (
    "key" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "public_name" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cv_position_choices_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "cv_position_choices_key_check" CHECK (char_length("key") BETWEEN 3 AND 200 AND position(':' IN "key") > 1),
    CONSTRAINT "cv_position_choices_public_name_check" CHECK ("public_name" IS NULL OR char_length("public_name") BETWEEN 1 AND 80)
);

ALTER TABLE "cv_position_choices" ADD CONSTRAINT "cv_position_choices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
