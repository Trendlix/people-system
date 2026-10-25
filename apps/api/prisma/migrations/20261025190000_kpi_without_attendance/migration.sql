-- Attendance leaves the KPI (owner, 25 October 2026, on KPI Pillars' "Attendance counts here", asked whether
-- attendance is then cut twice, on the fixed part of the pay below the 90% grace and through the KPI's Attendance metric
-- on the variable part: "Fixed cut only"; packages/shared kpis.ts). The short hours cut the fixed part as before; the
-- KPI measures performance only.
--
-- 1. The KPI settings' Attendance in the KPI: a switch HR and a Super Admin keep, off from today (the row's too).
-- 2. Each scorecard keeps whether its Attendance metric counts: every one so far did; those not final yet (self-rating,
--    with the manager, with HR, sign-off, the practice ones too) follow the setting, so they are worked out without it
--    from now. Their kept score (final %, level, pillars) is worked out again in TypeScript, as kpiScore does it, when
--    the API starts (apps/api kpi-rescore.service.ts). A final scorecard keeps its result exactly.
-- The templates' Attendance points and the pillar sets' Attendance pillar stay as they are, so switching it on again
-- brings them back.

-- 1.
ALTER TABLE "kpi_settings" ADD COLUMN "attendance_in_kpi" BOOLEAN NOT NULL DEFAULT false;

-- 2.
ALTER TABLE "kpi_scorecards" ADD COLUMN "attendance_counted" BOOLEAN NOT NULL DEFAULT true;
UPDATE "kpi_scorecards" SET "attendance_counted" = false WHERE "status" <> 'final';
