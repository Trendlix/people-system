-- A job title's own KPI pillars (owner, 3 November 2026: "Yes Please", to a job title having its own pillar names, not
-- only weights): a template version whose pillars (and the Attendance metric's pillar) are its job title's own, kept as
-- they are whatever its team's, department's or the company's pillars become. Its own weights are in them, so none apart.
ALTER TABLE "kpi_templates" ADD COLUMN "own_pillars" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_own_pillars_weights_check" CHECK (NOT "own_pillars" OR "own_weights" IS NULL);
