-- Payroll Setup (owner's request, 16 October 2026: "creating a setup page for payroll to enter the variables that might
-- affect the sheet"): one page for everything that changes the payroll sheet. Changed rules apply to runs made or
-- refreshed afterwards; an approved run keeps what it was worked out with.

-- 1. The day of the month salaries are paid, 1 to 31, optional: the date HR marks a run paid on, to start with, in the
-- month after the run's (the salaries for a month are paid once it is over). A day past a month's end is its last day.
ALTER TABLE "payroll_settings" ADD COLUMN "payday" INTEGER,
  ADD CONSTRAINT "payroll_settings_payday_check" CHECK ("payday" BETWEEN 1 AND 31);

-- 2. The basic salary's share of the gross a new contract or offer starts with, a whole percent from 1 to 100: 80, as
-- it was fixed until now. A signed contract keeps its own.
ALTER TABLE "contract_settings" ADD COLUMN "basic_percent_default" INTEGER NOT NULL DEFAULT 80,
  ADD CONSTRAINT "contract_settings_basic_percent_default_check" CHECK ("basic_percent_default" BETWEEN 1 AND 100);

-- 3. The year's official holidays, one day each (a holiday of several days is a row per day). A holiday on a shift's
-- working day takes that day's hours out of the expected hours a run works out for each monthly-paid person.
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "holidays_name_en_check" CHECK (length(btrim("name_en")) > 0)
);
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");
