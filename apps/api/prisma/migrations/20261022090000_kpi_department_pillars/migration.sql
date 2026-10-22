-- KPI pillars by department, weights by job title (owner, 22 October 2026: "but i need pillars to each department /
-- wights can be changed for each department and Job title"). The rules: packages/shared kpi-framework.ts; the module:
-- apps/api/src/kpis.
--
-- 1. A framework version is the company's (no department: every version so far) or a department's own, numbered and
--    dated within its department as the company's are: one version a number and one a first month for the company, and
--    for each department (NULLS NOT DISTINCT: the company's count as one). A department's version may take it back to
--    the company's pillars from its month (follows_company): it has no pillars of its own then. Gone with its
--    department.
-- 2. A template version may keep its job title's own weights for its pillars, by pillar key ({"delivery": 40, …}); none:
--    its department's (or the company's).

-- 1.
ALTER TABLE "kpi_frameworks" ADD COLUMN "department_id" UUID,
ADD COLUMN "follows_company" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX "kpi_frameworks_version_key";
DROP INDEX "kpi_frameworks_applies_from_key";

CREATE UNIQUE INDEX "kpi_frameworks_department_id_version_key" ON "kpi_frameworks"("department_id", "version") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "kpi_frameworks_department_id_applies_from_key" ON "kpi_frameworks"("department_id", "applies_from") NULLS NOT DISTINCT;

ALTER TABLE "kpi_frameworks" DROP CONSTRAINT "kpi_frameworks_pillars_check",
DROP CONSTRAINT "kpi_frameworks_attendance_pillar_check";

ALTER TABLE "kpi_frameworks" ADD CONSTRAINT "kpi_frameworks_pillars_check" CHECK (
    CASE WHEN "follows_company" THEN "pillars" = '[]'::jsonb
    ELSE jsonb_typeof("pillars") = 'array' AND jsonb_array_length("pillars") BETWEEN 1 AND 8 END
);
-- the Attendance metric's pillar is one of them; none when it follows the company's
ALTER TABLE "kpi_frameworks" ADD CONSTRAINT "kpi_frameworks_attendance_pillar_check" CHECK (
    CASE WHEN "follows_company" THEN "attendance_pillar" = ''
    ELSE "pillars" @> jsonb_build_array(jsonb_build_object('key', "attendance_pillar")) END
);
-- only a department's version follows the company's
ALTER TABLE "kpi_frameworks" ADD CONSTRAINT "kpi_frameworks_follows_company_check" CHECK (NOT "follows_company" OR "department_id" IS NOT NULL);

ALTER TABLE "kpi_frameworks" ADD CONSTRAINT "kpi_frameworks_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2.
ALTER TABLE "kpi_templates" ADD COLUMN "own_weights" JSONB;

ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_own_weights_check" CHECK ("own_weights" IS NULL OR jsonb_typeof("own_weights") = 'object');
