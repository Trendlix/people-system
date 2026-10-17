-- Effective from on a raise request (owner, 17 October 2026: "in the request their should be a tab called Effective
-- from"): the month the raise is asked from, as the 1st of it (a raise takes effect on the 1st of a month, 16 October
-- 2026). Required on a new request (the API checks it: this month in Cairo or a later one); the requests asked for
-- before have none. HR's approval takes it as the raise's effective date unless HR sets another. A new column only:
-- nothing that is there changes.
ALTER TABLE "raise_requests" ADD COLUMN "effective_from" DATE,
  ADD CONSTRAINT "raise_requests_effective_from_check" CHECK ("effective_from" IS NULL OR EXTRACT(DAY FROM "effective_from") = 1);
