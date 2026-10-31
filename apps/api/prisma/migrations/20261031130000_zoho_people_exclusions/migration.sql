-- People left out of Zoho People's fetch (owner, 31 October 2026: "can i exclude users from the zoho api?"; he chose "Add
-- an exclusion list": "On Organization → Zoho People, HR or a Super Admin picks people to leave out. The nightly and
-- manual fetches skip them, and each run says how many were left out. Zoho days already fetched stay as history.").

-- the list: one a person, why (at most 500 characters), who added them and when
CREATE TABLE "zoho_people_exclusions" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reason" TEXT,
    "added_by" UUID,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "zoho_people_exclusions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zoho_people_exclusions_reason_check" CHECK ("reason" IS NULL OR (length(btrim("reason")) > 0 AND length("reason") <= 500))
);
CREATE UNIQUE INDEX "zoho_people_exclusions_employee_id_key" ON "zoho_people_exclusions"("employee_id");
ALTER TABLE "zoho_people_exclusions" ADD CONSTRAINT "zoho_people_exclusions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zoho_people_exclusions" ADD CONSTRAINT "zoho_people_exclusions_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- each run keeps whom it left out, so its summary names them
ALTER TABLE "zoho_people_runs" ADD COLUMN "excluded_ids" UUID[] DEFAULT ARRAY[]::UUID[];
