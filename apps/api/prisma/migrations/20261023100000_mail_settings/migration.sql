-- The company's email (SMTP) settings in the system (owner, 23 October 2026: "why dont we add SMTP setup in the
-- organization setup"): Organization → Email Settings, a Super Admin's only, one row (id 1), made on the first save.
-- Used while switched on and complete; else the server's deploy/.env, as before. The password is kept encrypted
-- (AES-256-GCM, "v1:iv:tag:ciphertext"), with a fingerprint of the key that sealed it; the last test email's result.
CREATE TABLE "mail_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 'other',
    "host" TEXT,
    "port" INTEGER NOT NULL DEFAULT 587,
    "security" TEXT NOT NULL DEFAULT 'starttls',
    "username" TEXT,
    "password_enc" TEXT,
    "password_key_id" TEXT,
    "from_name" TEXT,
    "from_address" TEXT,
    "reply_to" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_test_at" TIMESTAMPTZ,
    "last_test_ok" BOOLEAN,
    "last_test_message" TEXT,

    CONSTRAINT "mail_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mail_settings_id_check" CHECK ("id" = 1),
    CONSTRAINT "mail_settings_provider_check" CHECK ("provider" IN ('google', 'microsoft', 'zoho', 'other')),
    CONSTRAINT "mail_settings_security_check" CHECK ("security" IN ('starttls', 'ssl', 'none')),
    CONSTRAINT "mail_settings_port_check" CHECK ("port" BETWEEN 1 AND 65535),
    -- a password is never kept without the key's fingerprint, nor the fingerprint without it
    CONSTRAINT "mail_settings_password_check" CHECK (("password_enc" IS NULL) = ("password_key_id" IS NULL))
);

ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
