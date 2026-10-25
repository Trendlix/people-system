-- Earlier job offers (owner, 25 October 2026: "allow the HR to add for now job offers with a past duedate to enter the
-- previous data"): Recruitment Settings' switch "Entering earlier offers", on for now (the owner switches it off once the
-- old offers are in), and an offer's mark that it is an earlier one: saved with a past last day, or recorded as sent
-- outside the system ("Record as sent earlier": no email, no link), while the switch was on. No offer so far is one.
--
-- A sent offer's way gains "outside" (packages/shared offers.ts OFFER_SENT_WAYS); the check is the one of
-- 20261016100000_bilingual_templates_and_checks with it added.

ALTER TABLE "recruitment_settings" ADD COLUMN "earlier_offers" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "job_offers" ADD COLUMN "recorded_earlier" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "job_offers" DROP CONSTRAINT "job_offers_sent_via_check";
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_sent_via_check" CHECK ("sent_via" IN ('email', 'link', 'outside'));
