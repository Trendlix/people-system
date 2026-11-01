-- The KPI reminder (owner, 1 November 2026: "in a popup reminder on each login", "can be postponed for 1 day only"):
-- until when someone put it off, and the month's round they did it for (once a round).
ALTER TABLE "users" ADD COLUMN "kpi_reminder_postponed_until" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "kpi_reminder_postponed_round" TEXT;
