-- Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
-- remember his password", "via app and web"): each code kept only as an HMAC with the server's secret, working once for
-- 10 minutes and 5 tries; a new one ends the one before.
CREATE TABLE "login_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "ip" TEXT,
    CONSTRAINT "login_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "login_codes_attempts_check" CHECK ("attempts" >= 0)
);
CREATE INDEX "login_codes_user_id_created_at_idx" ON "login_codes"("user_id", "created_at");
ALTER TABLE "login_codes" ADD CONSTRAINT "login_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
