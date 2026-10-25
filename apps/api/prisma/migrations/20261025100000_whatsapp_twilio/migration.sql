-- Twilio as a second way to send WhatsApp (owner, 25 October 2026: "is the system ready to be linked with twillio?";
-- asked, "Add Twilio as a choice": WhatsApp Settings gets "Send through: Meta directly / Twilio", the same messages,
-- opt-ins, quiet hours, queue and log; and "No, WhatsApp only": no SMS; packages/shared whatsapp-twilio.ts). Written by
-- hand. No notification kind is added: notifications_kind_check stays as it is.

-- 1. The settings: which provider sends (Meta directly, as before, unless changed), and Twilio's: the Account SID, the
--    Auth Token sealed as the Meta token is (AES-256-GCM, "v1:iv:tag:ciphertext", with the fingerprint of the key that
--    sealed it; never returned), the WhatsApp sender (whatsapp:+20…, or the SID of a Messaging Service holding it), the
--    last sync of its templates, and the last signed call from Twilio.
ALTER TABLE "whatsapp_settings"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'meta',
  ADD COLUMN "twilio_account_sid" TEXT,
  ADD COLUMN "twilio_auth_token_enc" TEXT,
  ADD COLUMN "twilio_auth_token_key_id" TEXT,
  ADD COLUMN "twilio_sender" TEXT,
  ADD COLUMN "twilio_templates_synced_at" TIMESTAMPTZ,
  ADD COLUMN "twilio_event_at" TIMESTAMPTZ,
  ADD CONSTRAINT "whatsapp_settings_provider_check" CHECK ("provider" IN ('meta', 'twilio')),
  ADD CONSTRAINT "whatsapp_settings_twilio_account_sid_check" CHECK ("twilio_account_sid" IS NULL OR "twilio_account_sid" ~ '^AC[0-9a-fA-F]{32}$'),
  -- the token is never kept without its key's fingerprint, nor the fingerprint without it
  ADD CONSTRAINT "whatsapp_settings_twilio_auth_token_check" CHECK (("twilio_auth_token_enc" IS NULL) = ("twilio_auth_token_key_id" IS NULL)),
  ADD CONSTRAINT "whatsapp_settings_twilio_sender_check" CHECK (
    "twilio_sender" IS NULL OR "twilio_sender" ~ '^whatsapp:\+[0-9]{8,15}$' OR "twilio_sender" ~ '^MG[0-9a-f]{32}$'
  );

-- 2. The templates on Twilio: the same text made as Twilio Content (its SID, HX…), named people_<key>_<language>,
--    submitted for WhatsApp's approval, then synced. Twilio's own approval state, apart from Meta's (whatsapp_templates).
CREATE TABLE "whatsapp_twilio_templates" (
    "key" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_sid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_submitted',
    "reason" TEXT,
    "submitted_at" TIMESTAMPTZ,
    "synced_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_twilio_templates_pkey" PRIMARY KEY ("key", "language"),
    CONSTRAINT "whatsapp_twilio_templates_language_check" CHECK ("language" IN ('en', 'ar')),
    CONSTRAINT "whatsapp_twilio_templates_status_check" CHECK ("status" IN ('not_submitted', 'pending', 'approved', 'rejected', 'paused', 'disabled', 'in_appeal', 'other')),
    CONSTRAINT "whatsapp_twilio_templates_name_check" CHECK ("name" ~ '^[a-z0-9_]+$' AND char_length("name") <= 512),
    CONSTRAINT "whatsapp_twilio_templates_content_sid_check" CHECK ("content_sid" IS NULL OR "content_sid" ~ '^HX[0-9a-fA-F]{32}$')
);

CREATE UNIQUE INDEX "whatsapp_twilio_templates_content_sid_key" ON "whatsapp_twilio_templates"("content_sid");

-- 3. Each message: who sent it (none while it waits: a message waiting is sent by whichever provider sends then). Its id
--    at the provider stays in "wamid": Meta's message id, or Twilio's message SID (SM…).
ALTER TABLE "whatsapp_messages"
  ADD COLUMN "provider" TEXT,
  ADD CONSTRAINT "whatsapp_messages_provider_check" CHECK ("provider" IS NULL OR "provider" IN ('meta', 'twilio'));
