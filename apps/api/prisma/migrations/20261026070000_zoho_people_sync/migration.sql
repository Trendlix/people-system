-- Zoho People's check-ins and check-outs pulled in (owner, 25 October 2026: "can i fetch checkin and out transactions
-- from zoho people through api?"; asked, "Yes, daily + backfill"; then "but can it fetch historical data?"; packages/shared
-- zoho-people.ts). Written by hand. It takes a database that has these tables already as it is (IF NOT EXISTS, and each
-- constraint added only when missing): the shared test database ran this build's first version of it under an earlier
-- name, 20261026030000_zoho_people_sync, before the main tree moved past that time.

-- The connection (one row, id 1): the Zoho account a Super Admin signed in as, its refresh token sealed (never
-- returned) with the key's fingerprint beside it, the sign-in's data centre, Zoho People's own time zone and date format,
-- and the last test.
CREATE TABLE IF NOT EXISTS "zoho_people_connections" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "account_email" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "token_key_id" TEXT NOT NULL,
    "accounts_server" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "problem" TEXT,
    "time_zone" TEXT,
    "date_format" TEXT,
    "connected_by" UUID,
    "connected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_test_at" TIMESTAMPTZ,
    "last_test_ok" BOOLEAN,
    "last_test_message" TEXT,

    CONSTRAINT "zoho_people_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zoho_people_connections_one_row" CHECK ("id" = 1),
    CONSTRAINT "zoho_people_connections_status_check" CHECK ("status" IN ('connected', 'needs_reconnecting'))
);

-- A fetch: the nightly one (one a day) or HR's, its days and people, where it stands, its plan and where it got to (so
-- it goes on after a restart), and what it did.
CREATE TABLE IF NOT EXISTS "zoho_people_runs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "nightly_for" DATE,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "employee_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_by" UUID,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "heartbeat_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancel_requested_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "waiting_until" TIMESTAMPTZ,
    "plan" JSONB NOT NULL,
    "cursor" JSONB,
    "people_total" INTEGER NOT NULL,
    "people_done" INTEGER NOT NULL DEFAULT 0,
    "calls_total" INTEGER NOT NULL,
    "calls_done" INTEGER NOT NULL DEFAULT 0,
    "days_added" INTEGER NOT NULL DEFAULT 0,
    "punches_added" INTEGER NOT NULL DEFAULT 0,
    "days_replaced" INTEGER NOT NULL DEFAULT 0,
    "days_unchanged" INTEGER NOT NULL DEFAULT 0,
    "days_recorded" INTEGER NOT NULL DEFAULT 0,
    "lines_refilled" INTEGER NOT NULL DEFAULT 0,
    "skipped" JSONB NOT NULL DEFAULT '{}',
    "not_found" UUID[] DEFAULT ARRAY[]::UUID[],
    "errors" JSONB NOT NULL DEFAULT '[]',
    "problem" TEXT,

    CONSTRAINT "zoho_people_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zoho_people_runs_kind_check" CHECK ("kind" IN ('nightly', 'fetch')),
    CONSTRAINT "zoho_people_runs_status_check" CHECK ("status" IN ('running', 'finished', 'failed', 'cancelled')),
    CONSTRAINT "zoho_people_runs_dates_check" CHECK ("from_date" <= "to_date"),
    CONSTRAINT "zoho_people_runs_nightly_check" CHECK (("kind" = 'nightly') = ("nightly_for" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "zoho_people_runs_nightly_for_key" ON "zoho_people_runs"("nightly_for");
CREATE INDEX IF NOT EXISTS "zoho_people_runs_started_at_idx" ON "zoho_people_runs"("started_at");

-- A Zoho day kept by a fetch from Zoho People's API, not by an Excel import: which run kept it last.
ALTER TABLE "attendance_days" ADD COLUMN IF NOT EXISTS "zoho_run_id" UUID;

-- The foreign keys, each added only when missing.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zoho_people_connections_connected_by_fkey') THEN
        ALTER TABLE "zoho_people_connections" ADD CONSTRAINT "zoho_people_connections_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zoho_people_runs_started_by_fkey') THEN
        ALTER TABLE "zoho_people_runs" ADD CONSTRAINT "zoho_people_runs_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zoho_people_runs_cancelled_by_fkey') THEN
        ALTER TABLE "zoho_people_runs" ADD CONSTRAINT "zoho_people_runs_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_days_zoho_run_id_fkey') THEN
        ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_zoho_run_id_fkey" FOREIGN KEY ("zoho_run_id") REFERENCES "zoho_people_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
