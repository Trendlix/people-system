-- The KPI framework (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", then "Fully flexible": add
-- or remove pillars, with names and weights, applying from next month; templates place their metrics in the new
-- pillars). The four pillars and their weights were fixed in the code (packages/shared kpis.ts KPI_PILLARS, ids 1–4);
-- now they are a versioned framework HR changes, each template version keeping the pillars it was published with. The
-- rules: packages/shared kpi-framework.ts; the module: apps/api/src/kpis.
--
-- 1. The frameworks: a version's pillars, in order ([{ key, name, short, weight }], 1 to 8), the key of the Attendance
--    metric's pillar, and the first month whose scorecards it scores. Version 1 is the four of the plan with the
--    Attendance metric in Discipline & Growth, in force from the start, so nothing changes until HR edits them.
-- 2. The template versions keep their pillars (a copy) and, once published, the framework they were published with:
--    every version so far has version 1's.
-- 3. A metric's pillar becomes the key of one of its version's pillars (1 delivery, 2 quality, 3 clients, 4 discipline);
--    a draft's metric whose pillar is gone from the framework has none (Unplaced), with the name of the one it was in.
-- 4. The scorecards' kept pillar percents are by the pillars' keys too.

-- 1.
CREATE TABLE "kpi_frameworks" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "applies_from" DATE NOT NULL,
    "pillars" JSONB NOT NULL,
    "attendance_pillar" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kpi_frameworks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_frameworks_version_check" CHECK ("version" >= 1),
    CONSTRAINT "kpi_frameworks_applies_from_check" CHECK (date_part('day', "applies_from") = 1),
    CONSTRAINT "kpi_frameworks_pillars_check" CHECK (jsonb_typeof("pillars") = 'array' AND jsonb_array_length("pillars") BETWEEN 1 AND 8),
    -- the Attendance metric's pillar is one of them
    CONSTRAINT "kpi_frameworks_attendance_pillar_check" CHECK ("pillars" @> jsonb_build_array(jsonb_build_object('key', "attendance_pillar")))
);

CREATE UNIQUE INDEX "kpi_frameworks_version_key" ON "kpi_frameworks"("version");

CREATE UNIQUE INDEX "kpi_frameworks_applies_from_key" ON "kpi_frameworks"("applies_from");

ALTER TABLE "kpi_frameworks" ADD CONSTRAINT "kpi_frameworks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kpi_frameworks" ADD CONSTRAINT "kpi_frameworks_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "kpi_frameworks" ("id", "version", "applies_from", "pillars", "attendance_pillar", "updated_at") VALUES (
    gen_random_uuid(),
    1,
    '2000-01-01',
    '[{"key": "delivery", "name": "Delivery & Timeliness", "short": "Delivery", "weight": 30},
      {"key": "quality", "name": "Quality of Work", "short": "Quality", "weight": 25},
      {"key": "clients", "name": "Clients & Teamwork", "short": "Clients", "weight": 25},
      {"key": "discipline", "name": "Discipline & Growth", "short": "Discipline", "weight": 20}]'::jsonb,
    'discipline',
    now()
);

-- 2.
ALTER TABLE "kpi_templates" ADD COLUMN "framework_id" UUID,
ADD COLUMN "pillars" JSONB,
ADD COLUMN "attendance_pillar" TEXT;

UPDATE "kpi_templates" SET
    "pillars" = (SELECT "pillars" FROM "kpi_frameworks" WHERE "version" = 1),
    "attendance_pillar" = 'discipline',
    "framework_id" = CASE WHEN "status" = 'published' THEN (SELECT "id" FROM "kpi_frameworks" WHERE "version" = 1) END;

ALTER TABLE "kpi_templates" ALTER COLUMN "pillars" SET NOT NULL,
ALTER COLUMN "attendance_pillar" SET NOT NULL;

ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_pillars_check" CHECK (jsonb_typeof("pillars") = 'array' AND jsonb_array_length("pillars") BETWEEN 1 AND 8);
ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_attendance_pillar_check" CHECK ("pillars" @> jsonb_build_array(jsonb_build_object('key', "attendance_pillar")));
-- a published version has the framework it was published with
ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_framework_check" CHECK ("status" <> 'published' OR "framework_id" IS NOT NULL);

CREATE INDEX "kpi_templates_framework_id_idx" ON "kpi_templates"("framework_id");

ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "kpi_frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3.
ALTER TABLE "kpi_metrics" DROP CONSTRAINT "kpi_metrics_pillar_check";

ALTER TABLE "kpi_metrics" ALTER COLUMN "pillar" DROP NOT NULL,
ALTER COLUMN "pillar" TYPE TEXT USING (CASE "pillar" WHEN 1 THEN 'delivery' WHEN 2 THEN 'quality' WHEN 3 THEN 'clients' WHEN 4 THEN 'discipline' END);

ALTER TABLE "kpi_metrics" ADD COLUMN "was_in" TEXT;

ALTER TABLE "kpi_metrics" ADD CONSTRAINT "kpi_metrics_pillar_check" CHECK ("pillar" IS NULL OR ("pillar" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("pillar") <= 40));
-- only a metric in Unplaced says the pillar it was in
ALTER TABLE "kpi_metrics" ADD CONSTRAINT "kpi_metrics_was_in_check" CHECK ("was_in" IS NULL OR ("pillar" IS NULL AND length("was_in") <= 60));

-- 4.
UPDATE "kpi_scorecards" SET "pillars" = (
    SELECT jsonb_object_agg(CASE "key" WHEN '1' THEN 'delivery' WHEN '2' THEN 'quality' WHEN '3' THEN 'clients' WHEN '4' THEN 'discipline' ELSE "key" END, "value")
    FROM jsonb_each("pillars")
)
WHERE "pillars" IS NOT NULL AND jsonb_typeof("pillars") = 'object' AND "pillars" <> '{}'::jsonb;
