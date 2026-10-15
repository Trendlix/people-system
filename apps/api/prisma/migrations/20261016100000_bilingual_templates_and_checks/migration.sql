-- A template may have Arabic and English side by side (the owner's NDA, 15 October 2026): its language is then
-- "bilingual", and the tags that depend on the language print in Arabic unless they name theirs ({{job_title_en}} …).
ALTER TABLE "template_versions" DROP CONSTRAINT "template_versions_language_check",
  ADD CONSTRAINT "template_versions_language_check" CHECK ("language" IN ('ar', 'en', 'bilingual'));

-- What the API checks on pay, allowances and offers, kept by the database too: a monthly salary or by the hour, up to
-- the legal 48 hours over at most 6 days a week, allowances of more than 0, and an offer's own steps.
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_pay_basis_check" CHECK ("pay_basis" IN ('monthly', 'hourly')),
  ADD CONSTRAINT "contracts_days_per_week_check" CHECK ("days_per_week" BETWEEN 1 AND 6),
  ADD CONSTRAINT "contracts_hours_per_week_check" CHECK ("hours_per_week" > 0 AND "hours_per_week" <= 48);

ALTER TABLE "contract_allowances" ADD CONSTRAINT "contract_allowances_amount_check" CHECK ("amount" > 0);
ALTER TABLE "offer_allowances" ADD CONSTRAINT "offer_allowances_amount_check" CHECK ("amount" > 0);

ALTER TABLE "job_offers"
  ADD CONSTRAINT "job_offers_status_check" CHECK ("status" IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn')),
  ADD CONSTRAINT "job_offers_sent_via_check" CHECK ("sent_via" IN ('email', 'link')),
  ADD CONSTRAINT "job_offers_pay_basis_check" CHECK ("pay_basis" IN ('monthly', 'hourly')),
  ADD CONSTRAINT "job_offers_probation_months_check" CHECK ("probation_months" BETWEEN 0 AND 3),
  ADD CONSTRAINT "job_offers_duration_months_check" CHECK ("duration_months" BETWEEN 1 AND 60),
  ADD CONSTRAINT "job_offers_days_per_week_check" CHECK ("days_per_week" BETWEEN 1 AND 6),
  ADD CONSTRAINT "job_offers_hours_per_week_check" CHECK ("hours_per_week" > 0 AND "hours_per_week" <= 48);
