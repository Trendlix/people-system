-- Assets, step 2: the Claude connector (owner, 21 October 2026: "i might link a claude account for the assets section
-- only to fetch data and help in the data entry"; asked how without paying extra: "the connection method" / "option a").
-- A remote MCP server on the website, signed in to with OAuth 2.1 (PKCE S256, dynamic client registration), scoped to
-- Assets. The rules: packages/shared connector.ts and asset-drafts.ts; the API: apps/api/src/connector.
--
-- 1. A third kind of session, 'connector': one a person (the newest wins), its client, its scope (assets) and the MCP
--    address its tokens are for (RFC 8707).
-- 2. The audit log marks what was done through the connector (via = 'claude_connector').
-- 3. The OAuth clients: registered by Claude (RFC 7591, "tlxcl_…") or read from a Client ID Metadata Document on
--    Claude's own hosts (its https address); Claude's documented return addresses only.
-- 4. The sign-in codes: kept as their SHA-256, with the PKCE challenge (S256), the client, the return address, the
--    person, 5 minutes, once.
-- 5. A connector session's tokens: access (an hour) and refresh (rotated on use), kept as their SHA-256.
-- 6. The asset drafts from Claude: never assets (no code, in no total), until a person confirms one.

-- 1.
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_kind_check";
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_kind_check" CHECK ("kind" IN ('web', 'app', 'connector'));
ALTER TABLE "sessions" ADD COLUMN "client_id" TEXT,
ADD COLUMN "scope" TEXT,
ADD COLUMN "resource" TEXT;
-- the client, scope and address are a connector's, and every connector session has them
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_connector_check" CHECK (("kind" = 'connector') = ("scope" IS NOT NULL AND "resource" IS NOT NULL));
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_scope_check" CHECK ("scope" IS NULL OR "scope" = 'assets');
CREATE INDEX "sessions_client_id_idx" ON "sessions"("client_id");

-- 2.
ALTER TABLE "audit_log" ADD COLUMN "via" TEXT;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_via_check" CHECK ("via" IS NULL OR "via" IN ('claude_connector'));

-- 3.
CREATE TABLE "connector_clients" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "auth_method" TEXT NOT NULL DEFAULT 'none',
    "secret_hash" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ,
    "fetched_at" TIMESTAMPTZ,

    CONSTRAINT "connector_clients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connector_clients_kind_check" CHECK ("kind" IN ('dcr', 'cimd')),
    CONSTRAINT "connector_clients_id_check" CHECK (("kind" = 'dcr' AND "id" ~ '^tlxcl_[A-Za-z0-9_-]{20,}$') OR ("kind" = 'cimd' AND "id" ~ '^https://(claude\.ai|claude\.com)/')),
    CONSTRAINT "connector_clients_name_check" CHECK (btrim("name") <> '' AND length("name") <= 100),
    -- only Claude's documented return addresses (packages/shared CLAUDE_REDIRECT_URIS), at least one
    CONSTRAINT "connector_clients_redirect_uris_check" CHECK (cardinality("redirect_uris") >= 1 AND "redirect_uris" <@ ARRAY['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback']::TEXT[]),
    CONSTRAINT "connector_clients_auth_method_check" CHECK ("auth_method" IN ('none', 'client_secret_post', 'client_secret_basic')),
    -- a secret exactly when the client authenticates with one; a metadata document's client never does
    CONSTRAINT "connector_clients_secret_check" CHECK (("auth_method" = 'none') = ("secret_hash" IS NULL) AND ("kind" = 'dcr' OR "auth_method" = 'none')),
    CONSTRAINT "connector_clients_secret_hash_check" CHECK ("secret_hash" IS NULL OR "secret_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "connector_clients_ip_check" CHECK ("ip" IS NULL OR length("ip") <= 45)
);

CREATE INDEX "connector_clients_created_at_idx" ON "connector_clients"("created_at");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "connector_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4.
CREATE TABLE "connector_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "session_id" UUID,

    CONSTRAINT "connector_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connector_codes_code_hash_check" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "connector_codes_redirect_uri_check" CHECK ("redirect_uri" IN ('https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback')),
    CONSTRAINT "connector_codes_challenge_check" CHECK ("code_challenge" ~ '^[A-Za-z0-9_-]{43}$'),
    CONSTRAINT "connector_codes_scope_check" CHECK ("scope" = 'assets'),
    CONSTRAINT "connector_codes_expiry_check" CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "connector_codes_code_hash_key" ON "connector_codes"("code_hash");
CREATE INDEX "connector_codes_expires_at_idx" ON "connector_codes"("expires_at");

ALTER TABLE "connector_codes" ADD CONSTRAINT "connector_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "connector_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connector_codes" ADD CONSTRAINT "connector_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connector_codes" ADD CONSTRAINT "connector_codes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5.
CREATE TABLE "connector_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "rotated_at" TIMESTAMPTZ,

    CONSTRAINT "connector_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connector_tokens_kind_check" CHECK ("kind" IN ('access', 'refresh')),
    CONSTRAINT "connector_tokens_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    -- only a refresh token is rotated
    CONSTRAINT "connector_tokens_rotated_check" CHECK ("rotated_at" IS NULL OR "kind" = 'refresh'),
    CONSTRAINT "connector_tokens_expiry_check" CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "connector_tokens_token_hash_key" ON "connector_tokens"("token_hash");
CREATE INDEX "connector_tokens_session_id_kind_idx" ON "connector_tokens"("session_id", "kind");

ALTER TABLE "connector_tokens" ADD CONSTRAINT "connector_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6.
CREATE TABLE "asset_drafts" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL DEFAULT 'claude',
    "fields" JSONB NOT NULL,
    "values" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "confirmed_at" TIMESTAMPTZ,
    "confirmed_by" UUID,
    "asset_id" UUID,
    "discarded_at" TIMESTAMPTZ,
    "discarded_by" UUID,

    CONSTRAINT "asset_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_drafts_status_check" CHECK ("status" IN ('open', 'confirmed', 'discarded')),
    CONSTRAINT "asset_drafts_source_check" CHECK ("source" IN ('claude')),
    CONSTRAINT "asset_drafts_fields_check" CHECK (jsonb_typeof("fields") = 'object'),
    CONSTRAINT "asset_drafts_values_check" CHECK ("values" IS NULL OR jsonb_typeof("values") = 'object'),
    -- confirmed: when; discarded: when; open: neither (the asset it became may be deleted since, so it is not required)
    CONSTRAINT "asset_drafts_confirmed_check" CHECK (("status" = 'confirmed') = ("confirmed_at" IS NOT NULL)),
    CONSTRAINT "asset_drafts_discarded_check" CHECK (("status" = 'discarded') = ("discarded_at" IS NOT NULL))
);

CREATE INDEX "asset_drafts_status_created_at_idx" ON "asset_drafts"("status", "created_at" DESC);

ALTER TABLE "asset_drafts" ADD CONSTRAINT "asset_drafts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_drafts" ADD CONSTRAINT "asset_drafts_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_drafts" ADD CONSTRAINT "asset_drafts_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_drafts" ADD CONSTRAINT "asset_drafts_discarded_by_fkey" FOREIGN KEY ("discarded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
