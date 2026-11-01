-- Emails worded by HR (owner, 1 November 2026: "build the mail templetes"): a subject and a text a kind of email, with
-- fields filled in when sent; none saved, the system's words.
CREATE TABLE "email_templates" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "email_templates_subject_check" CHECK (length(btrim("subject")) BETWEEN 1 AND 200),
    CONSTRAINT "email_templates_body_check" CHECK (length(btrim("body")) BETWEEN 1 AND 10000)
);

ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
