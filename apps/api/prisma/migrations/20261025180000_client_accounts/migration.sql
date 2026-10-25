-- Client accounts and the accounts allowance (owner, 25 October 2026: "if an employee has an allowance per account, how
-- can we deal with it?"; asked, they chose a "Client accounts list", the rate "variable" and a part month "By days";
-- packages/shared client-accounts.ts). Written by hand. No notification kinds are added, so notifications_kind_check
-- stays as it is.

-- 1. How a kind of allowance is paid: a fixed amount a month (every kind until now), or per client account. A contract's
--    or an offer's allowance keeps its kind's basis as drafted; a per-account one has no amount (0): eligibility only,
--    so the amount checks of 20261016100000_bilingual_templates_and_checks ("amount" > 0) are stated again for each basis.
ALTER TABLE "allowance_types" ADD COLUMN     "basis" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "allowance_types" ADD CONSTRAINT "allowance_types_basis_check" CHECK ("basis" IN ('fixed', 'per_account'));

ALTER TABLE "contract_allowances" ADD COLUMN     "basis" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "contract_allowances" ADD CONSTRAINT "contract_allowances_basis_check" CHECK ("basis" IN ('fixed', 'per_account'));
ALTER TABLE "contract_allowances" DROP CONSTRAINT "contract_allowances_amount_check";
ALTER TABLE "contract_allowances" ADD CONSTRAINT "contract_allowances_amount_check" CHECK (("basis" = 'fixed' AND "amount" > 0) OR ("basis" = 'per_account' AND "amount" = 0));

ALTER TABLE "offer_allowances" ADD COLUMN     "basis" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "offer_allowances" ADD CONSTRAINT "offer_allowances_basis_check" CHECK ("basis" IN ('fixed', 'per_account'));
ALTER TABLE "offer_allowances" DROP CONSTRAINT "offer_allowances_amount_check";
ALTER TABLE "offer_allowances" ADD CONSTRAINT "offer_allowances_amount_check" CHECK (("basis" = 'fixed' AND "amount" > 0) OR ("basis" = 'per_account' AND "amount" = 0));

-- 2. The optional size tiers (Small, Medium, Large …), each with a default amount a month that fills in an account's.
CREATE TABLE "client_account_tiers" (
    "id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "default_amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "client_account_tiers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_account_tiers_default_amount_check" CHECK ("default_amount" > 0)
);

-- 3. The client accounts: names, an optional code (unique), tier and team, the default amount a month, the status.
CREATE TABLE "client_accounts" (
    "id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "code" TEXT,
    "tier_id" UUID,
    "default_amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "ended_on" DATE,
    "notes" TEXT,
    "department_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "client_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_accounts_default_amount_check" CHECK ("default_amount" > 0),
    CONSTRAINT "client_accounts_status_check" CHECK ("status" IN ('active', 'ended')),
    CONSTRAINT "client_accounts_ended_on_check" CHECK (("status" = 'ended') = ("ended_on" IS NOT NULL))
);

-- 4. A person on an account, under their employment, from a day to a day (none: still), at an amount a month.
CREATE TABLE "client_account_assignments" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "client_account_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_account_assignments_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "client_account_assignments_dates_check" CHECK ("to_date" IS NULL OR "to_date" >= "from_date")
);

CREATE UNIQUE INDEX "client_account_tiers_name_en_key" ON "client_account_tiers"("name_en");
CREATE UNIQUE INDEX "client_accounts_code_key" ON "client_accounts"("code");
CREATE INDEX "client_accounts_department_id_idx" ON "client_accounts"("department_id");
CREATE INDEX "client_accounts_tier_id_idx" ON "client_accounts"("tier_id");
CREATE INDEX "client_account_assignments_account_id_idx" ON "client_account_assignments"("account_id");
CREATE INDEX "client_account_assignments_employee_id_idx" ON "client_account_assignments"("employee_id");
CREATE INDEX "client_account_assignments_employment_id_idx" ON "client_account_assignments"("employment_id");

ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "client_account_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_account_assignments" ADD CONSTRAINT "client_account_assignments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "client_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_account_assignments" ADD CONSTRAINT "client_account_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_account_assignments" ADD CONSTRAINT "client_account_assignments_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. The per-account kind, "Accounts allowance" / "بدل حسابات": taxed, not insured, last in the list (HR may change both,
--    as with any kind). Not added when a kind of that name is there already, whatever its case (prisma/seed.ts adds it
--    to new databases).
INSERT INTO "allowance_types" ("id", "name_en", "name_ar", "taxable", "insured", "active", "sort_order", "basis", "created_at", "updated_at")
SELECT gen_random_uuid(), 'Accounts allowance', 'بدل حسابات', true, false, true,
       (SELECT COALESCE(MAX("sort_order"), 0) + 1 FROM "allowance_types"), 'per_account', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "allowance_types" WHERE lower("name_en") = lower('Accounts allowance'));
