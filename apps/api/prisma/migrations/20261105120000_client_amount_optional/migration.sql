-- A client added by a manager has no amount a month until HR sets it (owner, 5 November 2026: "allow managers to add
-- clients"; asked, "HR sets it later"). Its check (> 0) still holds for an amount set: a NULL passes it.
ALTER TABLE "client_accounts" ALTER COLUMN "default_amount" DROP NOT NULL;
