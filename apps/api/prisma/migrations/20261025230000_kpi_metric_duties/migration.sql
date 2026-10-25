-- A KPI metric linked to several JD duties (owner, 25 October 2026, on the template draft's "JD duty (optional)": "can
-- i select 2 job descriptions?", meaning two duties, then "Yes, several duties"; packages/shared kpis.ts
-- KpiMetric.jdDuties): the duties it measures, any of the job description's duty rows and duties typed, in order, each
-- once, at most 10 (KPI_TEMPLATE_LIMITS.duties).
--
-- Nothing is moved: a metric saved before keeps its one duty in jd_duty and none here, and is read as a list of that
-- one (kpiMetricDuties), so the drafts, the published versions and the scorecards on them read as they did. A metric
-- saved since keeps its duties here, and its first in jd_duty too (none: NULL), so a build from before still shows one.

ALTER TABLE "kpi_metrics" ADD COLUMN "jd_duties" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "kpi_metrics" ADD CONSTRAINT "kpi_metrics_jd_duties_check" CHECK (cardinality("jd_duties") <= 10);
