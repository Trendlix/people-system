-- Online interview meetings made by the system (owner, 24 October 2026: "can i link an online meeting service provider
-- to automatically generate meeting links? line teams - gogole meet - zoom - etc.."; asked, "Google Meet, Microsoft
-- Teams, Zoom", and "make it both": a company account a Super Admin connects once, and each HR person's own; packages/
-- shared meetings.ts). Written by hand.

-- A provider's app, one row each, set by a Super Admin on Organization → Meetings. The secrets sealed (AES-256-GCM,
-- "v1:iv:tag:ciphertext"), each with a fingerprint of the key that sealed it; Microsoft's tenant only on Microsoft's row,
-- Zoom's account and General app only on Zoom's.
CREATE TABLE "meeting_apps" (
    "provider" TEXT NOT NULL,
    "client_id" TEXT,
    "client_secret_enc" TEXT,
    "client_secret_key_id" TEXT,
    "tenant_id" TEXT,
    "account_id" TEXT,
    "user_client_id" TEXT,
    "user_client_secret_enc" TEXT,
    "user_client_secret_key_id" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_apps_pkey" PRIMARY KEY ("provider"),
    CONSTRAINT "meeting_apps_provider_check" CHECK ("provider" IN ('google', 'microsoft', 'zoom')),
    CONSTRAINT "meeting_apps_secret_check" CHECK (("client_secret_enc" IS NULL) = ("client_secret_key_id" IS NULL)),
    CONSTRAINT "meeting_apps_user_secret_check" CHECK (("user_client_secret_enc" IS NULL) = ("user_client_secret_key_id" IS NULL)),
    CONSTRAINT "meeting_apps_tenant_check" CHECK ("tenant_id" IS NULL OR "provider" = 'microsoft'),
    CONSTRAINT "meeting_apps_zoom_check" CHECK ("provider" = 'zoom' OR ("account_id" IS NULL AND "user_client_id" IS NULL AND "user_client_secret_enc" IS NULL))
);

ALTER TABLE "meeting_apps" ADD CONSTRAINT "meeting_apps_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A meetings connection: the company's (no user) or an HR person's own. Signed in by OAuth (its refresh token sealed,
-- never returned), but the company's Microsoft and Zoom, which host by the app alone as the mailbox or user named. One
-- company connection a provider, one of each person's; at most one company connection the default.
CREATE TABLE "meeting_connections" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "user_id" UUID,
    "account_email" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "token_key_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "problem" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "connected_by" UUID,
    "connected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,
    "last_test_at" TIMESTAMPTZ,
    "last_test_ok" BOOLEAN,
    "last_test_message" TEXT,

    CONSTRAINT "meeting_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meeting_connections_provider_check" CHECK ("provider" IN ('google', 'microsoft', 'zoom')),
    CONSTRAINT "meeting_connections_status_check" CHECK ("status" IN ('connected', 'needs_reconnecting')),
    CONSTRAINT "meeting_connections_token_check" CHECK (("refresh_token_enc" IS NULL) = ("token_key_id" IS NULL)),
    -- the default is a company connection; a person's own signs in
    CONSTRAINT "meeting_connections_default_check" CHECK (NOT "is_default" OR "user_id" IS NULL),
    CONSTRAINT "meeting_connections_signed_in_check" CHECK ("user_id" IS NULL OR "refresh_token_enc" IS NOT NULL)
);

CREATE UNIQUE INDEX "meeting_connections_provider_user_id_key" ON "meeting_connections"("provider", "user_id");
CREATE UNIQUE INDEX "meeting_connections_one_company" ON "meeting_connections"("provider") WHERE "user_id" IS NULL;
CREATE UNIQUE INDEX "meeting_connections_one_default" ON "meeting_connections"("is_default") WHERE "is_default";
CREATE INDEX "meeting_connections_user_id_idx" ON "meeting_connections"("user_id");

ALTER TABLE "meeting_connections" ADD CONSTRAINT "meeting_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_connections" ADD CONSTRAINT "meeting_connections_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An online interview's meeting: its provider and its id there go together, with the connection it was made with (kept
-- to move and delete it; emptied if that connection is removed) and the mailbox or user it lives in; what the provider
-- refused, in words.
ALTER TABLE "interviews" ADD COLUMN "meeting_provider" TEXT;
ALTER TABLE "interviews" ADD COLUMN "meeting_connection_id" UUID;
ALTER TABLE "interviews" ADD COLUMN "meeting_id" TEXT;
ALTER TABLE "interviews" ADD COLUMN "meeting_host" TEXT;
ALTER TABLE "interviews" ADD COLUMN "meeting_problem" TEXT;
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_meeting_provider_check" CHECK ("meeting_provider" IS NULL OR "meeting_provider" IN ('google', 'microsoft', 'zoom'));
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_meeting_check" CHECK (("meeting_provider" IS NULL) = ("meeting_id" IS NULL));

CREATE INDEX "interviews_meeting_connection_id_idx" ON "interviews"("meeting_connection_id");

ALTER TABLE "interviews" ADD CONSTRAINT "interviews_meeting_connection_id_fkey" FOREIGN KEY ("meeting_connection_id") REFERENCES "meeting_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The notice (packages/shared notifications.ts): a meetings connection that needs connecting again, for its owner. Every
-- kind kept: those of 20261023130000_access_no_contract, then this one.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN (
    'leave_waiting', 'leave_decided', 'permission_waiting', 'permission_decided',
    'reimbursement_waiting', 'reimbursement_decided', 'reimbursement_paid',
    'correction_waiting', 'correction_decided',
    'raise_request_waiting', 'pay_raise_waiting', 'pay_raise_decided',
    'payslip_issued', 'home_location_waiting', 'home_location_decided',
    'check_in_reminder', 'check_out_reminder',
    'kpi_self_rating', 'kpi_waiting', 'kpi_ready_to_sign',
    'wfh_waiting', 'wfh_decided',
    'custody_handover', 'custody_return', 'custody_overdue', 'custody_unsigned',
    'offboarding_items', 'offboarding_cleared', 'exit_interview',
    'vacancy_waiting', 'vacancy_decided', 'applications_new',
    'interview_scheduled', 'interview_feedback', 'hiring_suggestion', 'onboarding_items',
    'access_hold', 'access_grace', 'access_grace_ending', 'access_held',
    'od_waiting', 'od_decided',
    'access_no_contract',
    'meeting_connection'
));
