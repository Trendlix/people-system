-- The careers site's address (owner, 25 October 2026: the careers pages moved to the main website,
-- www.trendlix.com/en/careers, and people.trendlix.com/careers only redirects there; the owner asked that the links stop
-- relying on that redirect; packages/shared careers-base.ts): "Careers site address" in Recruitment Settings, HR's or a
-- Super Admin's to change, audited. Every public careers link the system makes is built on it: the invitation to apply's
-- link, a vacancy's apply links and "Open on the careers site", LinkedIn's redirect URL.
--
-- NULL: the standard, https://www.trendlix.com/en/careers. Nothing is moved: every row starts on the standard.
--
-- Written to apply on a database that has a "careers_site" column already: the shared test database kept one from a
-- stopped build's migration (20261025200000_careers_bilingual, never in production). That column is made this one (text,
-- nullable, no default) and any check of its on careers_site is dropped, whatever its name, before this check is added.

ALTER TABLE "recruitment_settings" ADD COLUMN IF NOT EXISTS "careers_site" TEXT;
ALTER TABLE "recruitment_settings" ALTER COLUMN "careers_site" TYPE TEXT, ALTER COLUMN "careers_site" DROP NOT NULL, ALTER COLUMN "careers_site" DROP DEFAULT;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'recruitment_settings'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%careers_site%'
  LOOP
    EXECUTE format('ALTER TABLE "recruitment_settings" DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE "recruitment_settings" ADD CONSTRAINT "recruitment_settings_careers_site_check" CHECK ("careers_site" IS NULL OR ("careers_site" LIKE 'https://%' AND length("careers_site") <= 200));
