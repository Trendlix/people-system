-- Notifications in the TrendLIX People app and on the site (owner, 20 October 2026: "Push notifications: yes (decisions,
-- things waiting for someone, a check-in reminder)"; apps/mobile/README.md, Phase 4). Each notification is kept in the
-- user's inbox (the bell) and pushed to their phones when the server's push is set up (FCM_PROJECT_ID, FCM_CLIENT_EMAIL,
-- FCM_PRIVATE_KEY). Short and general: names and dates, never a salary, an amount, a reason or a comment. Two reminders,
-- "You haven't checked in" and "Still checked in?", each sent once a user, day and kind, and switched off by the user if
-- they want. The rules: packages/shared notifications.ts; the emitter and the reminders: apps/api/src/notifications.

-- the inbox
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_kind_check" CHECK ("kind" IN (
        'leave_waiting', 'leave_decided', 'permission_waiting', 'permission_decided',
        'reimbursement_waiting', 'reimbursement_decided', 'reimbursement_paid',
        'correction_waiting', 'correction_decided',
        'raise_request_waiting', 'pay_raise_waiting', 'pay_raise_decided',
        'payslip_issued', 'home_location_waiting', 'home_location_decided',
        'check_in_reminder', 'check_out_reminder'
    )),
    CONSTRAINT "notifications_title_check" CHECK (length(btrim("title")) BETWEEN 1 AND 100),
    CONSTRAINT "notifications_body_check" CHECK (length("body") <= 200),
    -- an address on the site only: one "/" first, never another site's ("//")
    CONSTRAINT "notifications_link_check" CHECK ("link" IS NULL OR ("link" LIKE '/%' AND "link" NOT LIKE '//%' AND length("link") <= 300))
);

CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- the phones notifications are pushed to: one user a token (the last to sign in on a shared phone)
CREATE TABLE "push_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_devices_platform_check" CHECK ("platform" IN ('android', 'ios')),
    CONSTRAINT "push_devices_token_check" CHECK (length("token") BETWEEN 1 AND 4096)
);

CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");

CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");

ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- each user's reminder switches; no row: both on
CREATE TABLE "notification_settings" (
    "user_id" UUID NOT NULL,
    "check_in_reminder" BOOLEAN NOT NULL DEFAULT true,
    "check_out_reminder" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- the reminders sent: one a user, working day (Cairo) and kind
CREATE TABLE "reminders_sent" (
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_sent_pkey" PRIMARY KEY ("user_id", "day", "kind"),
    CONSTRAINT "reminders_sent_kind_check" CHECK ("kind" IN ('check_in_reminder', 'check_out_reminder'))
);

ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
