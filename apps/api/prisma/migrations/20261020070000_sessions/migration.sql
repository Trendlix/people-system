-- Sessions kept on the server (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes
-- inactive, then session to be terminated; only 1 active session per user online and 1 active mobile session to be
-- working spontaneously"; a second sign-in of the same kind: the new one wins; the 15 minutes for HR, Admin and Super
-- Admin, on the website and the app). The rules: packages/shared sessions.ts, apps/api/src/auth/session-rules.ts.
--
-- Each sign-in is a row; the session token names it, and the API refuses a token whose session has ended. A website and
-- an app session can be active together, one of each. The tokens signed before this change name no session: they are
-- refused once, and everyone signs in again.

CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "end_reason" TEXT,
    "user_agent" TEXT,
    "ip" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_kind_check" CHECK ("kind" IN ('web', 'app')),
    CONSTRAINT "sessions_end_reason_check" CHECK ("end_reason" IS NULL OR "end_reason" IN ('signed_out', 'replaced', 'idle', 'expired', 'revoked')),
    -- ended with a reason, or neither
    CONSTRAINT "sessions_ended_check" CHECK (("ended_at" IS NULL) = ("end_reason" IS NULL)),
    CONSTRAINT "sessions_user_agent_check" CHECK ("user_agent" IS NULL OR length("user_agent") <= 300),
    CONSTRAINT "sessions_ip_check" CHECK ("ip" IS NULL OR length("ip") <= 45)
);

CREATE INDEX "sessions_user_id_ended_at_idx" ON "sessions"("user_id", "ended_at");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
