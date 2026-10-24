-- WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"; after the explanation they
-- chose whom, "Employees and candidates"; what, "Approvals waiting, Request decisions, Check-in reminders, Interviews";
-- and how, "Directly to Meta": the WhatsApp Cloud API; packages/shared whatsapp.ts). One more channel beside the bell,
-- push and email, never in their place. Written by hand. No notification kind is added: WhatsApp is a channel, so
-- notifications_kind_check stays as 20261024160000_suggested_cvs left it.

-- 1. The settings: one row (id 1), a Super Admin's (Organization → Company → WhatsApp). The access token and the app
--    secret sealed (AES-256-GCM, "v1:iv:tag:ciphertext"), each with a fingerprint of the key that sealed it; the
--    webhook's verify token made by the system; quiet hours in Cairo ("HH:mm", none: any hour); the last test, the
--    templates' last sync, the webhook's last verification and last signed call.
CREATE TABLE "whatsapp_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "phone_number_id" TEXT,
    "business_account_id" TEXT,
    "display_phone" TEXT,
    "access_token_enc" TEXT,
    "access_token_key_id" TEXT,
    "app_secret_enc" TEXT,
    "app_secret_key_id" TEXT,
    "verify_token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "quiet_from" TEXT DEFAULT '22:00',
    "quiet_to" TEXT DEFAULT '08:00',
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_test_at" TIMESTAMPTZ,
    "last_test_ok" BOOLEAN,
    "last_test_message" TEXT,
    "templates_synced_at" TIMESTAMPTZ,
    "webhook_verified_at" TIMESTAMPTZ,
    "webhook_event_at" TIMESTAMPTZ,

    CONSTRAINT "whatsapp_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_settings_id_check" CHECK ("id" = 1),
    -- Meta's ids are numbers written as text
    CONSTRAINT "whatsapp_settings_phone_number_id_check" CHECK ("phone_number_id" IS NULL OR "phone_number_id" ~ '^[0-9]{5,30}$'),
    CONSTRAINT "whatsapp_settings_business_account_id_check" CHECK ("business_account_id" IS NULL OR "business_account_id" ~ '^[0-9]{5,30}$'),
    -- a secret is never kept without its key's fingerprint, nor the fingerprint without it
    CONSTRAINT "whatsapp_settings_access_token_check" CHECK (("access_token_enc" IS NULL) = ("access_token_key_id" IS NULL)),
    CONSTRAINT "whatsapp_settings_app_secret_check" CHECK (("app_secret_enc" IS NULL) = ("app_secret_key_id" IS NULL)),
    CONSTRAINT "whatsapp_settings_verify_token_check" CHECK ("verify_token" ~ '^[A-Za-z0-9_-]{24,64}$'),
    -- quiet hours: none, or two different times of day
    CONSTRAINT "whatsapp_settings_quiet_check" CHECK (
        ("quiet_from" IS NULL AND "quiet_to" IS NULL)
        OR ("quiet_from" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "quiet_to" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "quiet_from" <> "quiet_to")
    )
);

ALTER TABLE "whatsapp_settings" ADD CONSTRAINT "whatsapp_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. The templates as Meta last said: one row a template a language, submitted, then synced.
CREATE TABLE "whatsapp_templates" (
    "key" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_submitted',
    "reason" TEXT,
    "meta_id" TEXT,
    "submitted_at" TIMESTAMPTZ,
    "synced_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("key", "language"),
    CONSTRAINT "whatsapp_templates_language_check" CHECK ("language" IN ('en', 'ar')),
    CONSTRAINT "whatsapp_templates_status_check" CHECK ("status" IN ('not_submitted', 'pending', 'approved', 'rejected', 'paused', 'disabled', 'in_appeal', 'other')),
    CONSTRAINT "whatsapp_templates_name_check" CHECK ("name" ~ '^[a-z0-9_]+$' AND char_length("name") <= 512)
);

-- 3. An employee's own opt-in (required by Meta), never made by HR: the mobile it was given for, the language, the four
--    groups (all on when they opt in), when; turned off by them or by their replying STOP.
CREATE TABLE "whatsapp_opt_ins" (
    "user_id" UUID NOT NULL,
    "mobile" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "approvals" BOOLEAN NOT NULL DEFAULT true,
    "decisions" BOOLEAN NOT NULL DEFAULT true,
    "check_in" BOOLEAN NOT NULL DEFAULT true,
    "interviews" BOOLEAN NOT NULL DEFAULT true,
    "opted_in_at" TIMESTAMPTZ NOT NULL,
    "stopped_at" TIMESTAMPTZ,
    "stopped_by" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_opt_ins_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "whatsapp_opt_ins_language_check" CHECK ("language" IN ('en', 'ar')),
    CONSTRAINT "whatsapp_opt_ins_mobile_check" CHECK ("mobile" ~ '^\+[0-9]{8,15}$'),
    CONSTRAINT "whatsapp_opt_ins_stopped_check" CHECK (("stopped_at" IS NULL) = ("stopped_by" IS NULL) AND ("stopped_by" IS NULL OR "stopped_by" IN ('self', 'stop')))
);

CREATE INDEX "whatsapp_opt_ins_mobile_idx" ON "whatsapp_opt_ins"("mobile");

ALTER TABLE "whatsapp_opt_ins" ADD CONSTRAINT "whatsapp_opt_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. The candidates' tick on the careers forms ("Send me updates about my application on WhatsApp", off unless ticked),
--    kept on the application or general CV with the page's language, and on its candidate; a STOP reply's time on each.
--    HR's Add a CV has no tick: nothing is set.
ALTER TABLE "job_applications" ADD COLUMN "whatsapp_opt_in_at" TIMESTAMPTZ,
ADD COLUMN "whatsapp_language" TEXT,
ADD COLUMN "whatsapp_stopped_at" TIMESTAMPTZ;

ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_whatsapp_language_check" CHECK ("whatsapp_language" IS NULL OR "whatsapp_language" IN ('en', 'ar'));
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_whatsapp_check" CHECK ("whatsapp_stopped_at" IS NULL OR "whatsapp_opt_in_at" IS NOT NULL);

ALTER TABLE "general_cvs" ADD COLUMN "whatsapp_opt_in_at" TIMESTAMPTZ,
ADD COLUMN "whatsapp_language" TEXT,
ADD COLUMN "whatsapp_stopped_at" TIMESTAMPTZ;

ALTER TABLE "general_cvs" ADD CONSTRAINT "general_cvs_whatsapp_language_check" CHECK ("whatsapp_language" IS NULL OR "whatsapp_language" IN ('en', 'ar'));
ALTER TABLE "general_cvs" ADD CONSTRAINT "general_cvs_whatsapp_check" CHECK ("whatsapp_stopped_at" IS NULL OR "whatsapp_opt_in_at" IS NOT NULL);

ALTER TABLE "candidates" ADD COLUMN "whatsapp_opt_in_at" TIMESTAMPTZ,
ADD COLUMN "whatsapp_stopped_at" TIMESTAMPTZ;

-- 5. An interview's reminder to the candidate the day before, once (cleared when it moves).
ALTER TABLE "interviews" ADD COLUMN "whatsapp_reminded_at" TIMESTAMPTZ;

-- 6. The messages: to an employee who opted in, a candidate who ticked it, or the test's number; the template, the
--    language, the variables (names, dates and references only), the button's page, a reference for HR's log, whether
--    it is about a C-level person (never shown to HR); queued, sending, then Meta's statuses, or failed (why, Meta's
--    code) or cancelled; its tries and the next; at most one of a kind (dedupe_key).
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "candidate_id" UUID,
    "application_id" UUID,
    "general_cv_id" UUID,
    "interview_id" UUID,
    "mobile" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "template_name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "kind" TEXT,
    "group_key" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "reference" TEXT,
    "link" TEXT,
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "wamid" TEXT,
    "error" TEXT,
    "error_code" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "send_before" TIMESTAMPTZ,
    "dedupe_key" TEXT,
    "claimed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "read_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_messages_status_check" CHECK ("status" IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled')),
    CONSTRAINT "whatsapp_messages_language_check" CHECK ("language" IN ('en', 'ar')),
    CONSTRAINT "whatsapp_messages_template_check" CHECK ("template" IN (
        'approval_waiting', 'approvals_digest', 'request_update', 'payslip_ready',
        'access_on_hold', 'access_grace', 'access_grace_ending',
        'check_in_reminder', 'check_out_reminder', 'interview_panel',
        'application_received', 'cv_received', 'interview_invitation', 'interview_updated', 'interview_cancelled', 'interview_reminder',
        'test_message', 'stop_confirmation'
    )),
    CONSTRAINT "whatsapp_messages_group_check" CHECK ("group_key" IS NULL OR "group_key" IN ('approvals', 'decisions', 'check_in', 'interviews')),
    CONSTRAINT "whatsapp_messages_mobile_check" CHECK ("mobile" ~ '^\+[0-9]{8,15}$'),
    CONSTRAINT "whatsapp_messages_variables_check" CHECK (jsonb_typeof("variables") = 'object'),
    CONSTRAINT "whatsapp_messages_attempts_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "whatsapp_messages_wamid_key" ON "whatsapp_messages"("wamid");
CREATE UNIQUE INDEX "whatsapp_messages_dedupe_key_key" ON "whatsapp_messages"("dedupe_key");
CREATE INDEX "whatsapp_messages_status_next_attempt_at_idx" ON "whatsapp_messages"("status", "next_attempt_at");
CREATE INDEX "whatsapp_messages_created_at_idx" ON "whatsapp_messages"("created_at" DESC);
CREATE INDEX "whatsapp_messages_user_id_created_at_idx" ON "whatsapp_messages"("user_id", "created_at");
CREATE INDEX "whatsapp_messages_mobile_idx" ON "whatsapp_messages"("mobile");
CREATE INDEX "whatsapp_messages_candidate_id_idx" ON "whatsapp_messages"("candidate_id");
CREATE INDEX "whatsapp_messages_application_id_idx" ON "whatsapp_messages"("application_id");
CREATE INDEX "whatsapp_messages_general_cv_id_idx" ON "whatsapp_messages"("general_cv_id");
CREATE INDEX "whatsapp_messages_interview_id_idx" ON "whatsapp_messages"("interview_id");

ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_general_cv_id_fkey" FOREIGN KEY ("general_cv_id") REFERENCES "general_cvs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
