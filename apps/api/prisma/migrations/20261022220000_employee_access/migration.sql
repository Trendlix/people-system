-- Every active employee gets access (owner, 22 October 2026: "i dont thint that the users and employees needs to be
-- divided, any active employee with active contract should have access"; packages/shared employee-access.ts).
--
-- 1. An account is an employee's by a link, never by its email: users.employee_id, filled here for the accounts whose
--    email is an employee's work email (the match that linked them until now; both are unique, so one each at most).
-- 2. The email HR chose for an employee to sign in with ("let the HR Choose which mail to use"): work or personal;
--    none: the work email, else the personal one.
-- 3. Set-password links ("Set-password link"): an invitation (the first password) or a reset, for one account, valid
--    7 days, used once; only the token's SHA-256 is kept. A new one cancels the older ones waiting.
-- 4. Forgot password's and the set-password page's requests, counted for their limits (an email, an address).
-- 5. Until an account is linked, an account and an employee with the same work email are linked as they are made (an
--    account added on the Users page with an employee's work email, or a work email given to a profile whose person
--    has an account with it): the link the email meant until now, made once; after that only the link counts.

-- 1.
ALTER TABLE "users" ADD COLUMN "employee_id" UUID;
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "users" u
SET "employee_id" = e."id"
FROM "employees" e
WHERE e."work_email" IS NOT NULL AND lower(u."email") = lower(e."work_email");

-- 2.
ALTER TABLE "employees" ADD COLUMN "sign_in_email" TEXT;
ALTER TABLE "employees" ADD CONSTRAINT "employees_sign_in_email_check" CHECK ("sign_in_email" IS NULL OR "sign_in_email" IN ('work', 'personal'));

-- 3.
CREATE TABLE "access_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_by" UUID,
    "emailed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "access_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_links_purpose_check" CHECK ("purpose" IN ('invite', 'reset')),
    CONSTRAINT "access_links_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "access_links_expiry_check" CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "access_links_token_hash_key" ON "access_links"("token_hash");
CREATE INDEX "access_links_user_id_created_at_idx" ON "access_links"("user_id", "created_at");
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4.
CREATE TABLE "access_link_requests" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT,
    "ip" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_link_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_link_requests_kind_check" CHECK ("kind" IN ('forgot', 'set_failed'))
);

CREATE INDEX "access_link_requests_kind_email_at_idx" ON "access_link_requests"("kind", "email", "at");
CREATE INDEX "access_link_requests_kind_ip_at_idx" ON "access_link_requests"("kind", "ip", "at");

-- 5.
CREATE FUNCTION "link_user_by_work_email"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."employee_id" IS NULL THEN
    SELECT e."id" INTO NEW."employee_id"
    FROM "employees" e
    WHERE e."work_email" IS NOT NULL
      AND lower(e."work_email") = lower(NEW."email")
      AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."employee_id" = e."id" AND o."id" <> NEW."id")
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "users_link_by_work_email" BEFORE INSERT OR UPDATE OF "email" ON "users"
FOR EACH ROW EXECUTE FUNCTION "link_user_by_work_email"();

CREATE FUNCTION "link_employee_by_work_email"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."work_email" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."employee_id" = NEW."id") THEN
    UPDATE "users" SET "employee_id" = NEW."id"
    WHERE "employee_id" IS NULL AND lower("email") = lower(NEW."work_email");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "employees_link_by_work_email" AFTER INSERT OR UPDATE OF "work_email" ON "employees"
FOR EACH ROW EXECUTE FUNCTION "link_employee_by_work_email"();
