-- Interviewers' availability (owner, 25 October 2026: "is it better for each interviewer to add his available
-- interviews timeslots?"; asked, "Hours + calendar" and "HR only"; then "its zoho mails": Zoho Calendar is the main
-- calendar, Google and Microsoft stay; packages/shared interview-availability.ts and calendars.ts). Written by hand.

-- The company's defaults (one row, id 1): the least notice an interview is booked with, in hours, and the buffer between
-- one person's interviews, in minutes (the brief's 24 hours and 15 minutes); each person may only make theirs stricter.
CREATE TABLE "interview_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "notice_hours" INTEGER NOT NULL DEFAULT 24,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 15,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interview_settings_one_row" CHECK ("id" = 1),
    CONSTRAINT "interview_settings_notice_check" CHECK ("notice_hours" BETWEEN 0 AND 336),
    CONSTRAINT "interview_settings_buffer_check" CHECK ("buffer_minutes" BETWEEN 0 AND 120 AND "buffer_minutes" % 5 = 0)
);

ALTER TABLE "interview_settings" ADD CONSTRAINT "interview_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "interview_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;

-- Someone's interview hours: the weekly ranges and the one-off changes as JSON lists (checked by the API), the day the
-- ranges count from, and their own notice and buffer (empty: the company's).
CREATE TABLE "interview_hours" (
    "employee_id" UUID NOT NULL,
    "windows" JSONB NOT NULL DEFAULT '[]',
    "changes" JSONB NOT NULL DEFAULT '[]',
    "effective_from" DATE NOT NULL,
    "notice_hours" INTEGER,
    "buffer_minutes" INTEGER,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "interview_hours_pkey" PRIMARY KEY ("employee_id"),
    CONSTRAINT "interview_hours_windows_check" CHECK (jsonb_typeof("windows") = 'array'),
    CONSTRAINT "interview_hours_changes_check" CHECK (jsonb_typeof("changes") = 'array'),
    CONSTRAINT "interview_hours_notice_check" CHECK ("notice_hours" IS NULL OR "notice_hours" BETWEEN 0 AND 336),
    CONSTRAINT "interview_hours_buffer_check" CHECK ("buffer_minutes" IS NULL OR ("buffer_minutes" BETWEEN 0 AND 120 AND "buffer_minutes" % 5 = 0))
);

ALTER TABLE "interview_hours" ADD CONSTRAINT "interview_hours_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_hours" ADD CONSTRAINT "interview_hours_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A calendar's app: Zoho's (a Server-based Application at api-console.zoho.com), its secret sealed with the key's
-- fingerprint beside it, and the data centre the company's Zoho account is in.
CREATE TABLE "calendar_apps" (
    "provider" TEXT NOT NULL,
    "client_id" TEXT,
    "client_secret_enc" TEXT,
    "client_secret_key_id" TEXT,
    "data_centre" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_apps_pkey" PRIMARY KEY ("provider"),
    CONSTRAINT "calendar_apps_provider_check" CHECK ("provider" IN ('zoho')),
    CONSTRAINT "calendar_apps_secret_check" CHECK (("client_secret_enc" IS NULL) = ("client_secret_key_id" IS NULL)),
    CONSTRAINT "calendar_apps_data_centre_check" CHECK ("data_centre" IS NULL OR "data_centre" IN ('com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa', 'uk', 'ae', 'sg'))
);

ALTER TABLE "calendar_apps" ADD CONSTRAINT "calendar_apps_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A calendar connection, for busy times only: the company's Zoho (no user, one at most) or a person's own Zoho, Google or
-- Microsoft calendar (one of each a person). Always signed in: its refresh token sealed.
CREATE TABLE "calendar_connections" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "user_id" UUID,
    "account_email" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "token_key_id" TEXT NOT NULL,
    "accounts_server" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "problem" TEXT,
    "connected_by" UUID,
    "connected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,
    "last_test_at" TIMESTAMPTZ,
    "last_test_ok" BOOLEAN,
    "last_test_message" TEXT,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calendar_connections_provider_check" CHECK ("provider" IN ('zoho', 'google', 'microsoft')),
    CONSTRAINT "calendar_connections_status_check" CHECK ("status" IN ('connected', 'needs_reconnecting')),
    -- the company's is Zoho's (the company's mail); Zoho's knows its data centre
    CONSTRAINT "calendar_connections_company_check" CHECK ("user_id" IS NOT NULL OR "provider" = 'zoho'),
    CONSTRAINT "calendar_connections_zoho_check" CHECK ("provider" <> 'zoho' OR "accounts_server" IS NOT NULL)
);

CREATE UNIQUE INDEX "calendar_connections_provider_user_id_key" ON "calendar_connections"("provider", "user_id");
CREATE UNIQUE INDEX "calendar_connections_one_company" ON "calendar_connections"("provider") WHERE "user_id" IS NULL;
CREATE INDEX "calendar_connections_user_id_idx" ON "calendar_connections"("user_id");

ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- HR's own meetings connections share their busy times: Microsoft's always (its calendar permission reads them), Google's
-- once the free/busy scope is allowed (asked from now on; those connected before reconnect to share them).
ALTER TABLE "meeting_connections" ADD COLUMN "busy_times" BOOLEAN NOT NULL DEFAULT false;
UPDATE "meeting_connections" SET "busy_times" = true WHERE "provider" = 'microsoft' AND "user_id" IS NOT NULL;
