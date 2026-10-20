-- Fingerprint sign-in in the TrendLIX People app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the
-- first password sign-in"; apps/mobile/README.md, Phase 3). After a password sign-in in the app, the person may turn it
-- on: the API gives the phone a device credential, a random secret it keeps here only as its SHA-256, and the phone keeps
-- the secret behind its fingerprint. Trading the secret signs in an ordinary app session. The rules: packages/shared
-- device-credentials.ts and apps/api/src/auth/device-rules.ts.
--
-- One active credential a user per phone (a new one on the same device name and platform revokes the older one, under
-- the user's row lock). It stops signing in when revoked: by its owner, an Admin, a newer one on the phone, 90 days
-- without use, the account deactivated, the password changed or reset.

CREATE TABLE "device_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoke_reason" TEXT,

    CONSTRAINT "device_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "device_credentials_device_name_check" CHECK (length(btrim("device_name")) BETWEEN 1 AND 100),
    CONSTRAINT "device_credentials_platform_check" CHECK ("platform" IN ('android', 'ios')),
    -- the secret's SHA-256 in hex: never the secret itself
    CONSTRAINT "device_credentials_secret_hash_check" CHECK ("secret_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "device_credentials_revoke_reason_check" CHECK ("revoke_reason" IS NULL OR "revoke_reason" IN ('signed_out', 'replaced', 'expired', 'revoked', 'deactivated', 'password_changed', 'password_reset')),
    -- revoked with a reason, or neither
    CONSTRAINT "device_credentials_revoked_check" CHECK (("revoked_at" IS NULL) = ("revoke_reason" IS NULL)),
    CONSTRAINT "device_credentials_used_check" CHECK ("last_used_at" IS NULL OR "last_used_at" >= "created_at"),
    CONSTRAINT "device_credentials_revoked_after_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);

CREATE UNIQUE INDEX "device_credentials_secret_hash_key" ON "device_credentials"("secret_hash");

CREATE INDEX "device_credentials_user_id_revoked_at_idx" ON "device_credentials"("user_id", "revoked_at");

ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
