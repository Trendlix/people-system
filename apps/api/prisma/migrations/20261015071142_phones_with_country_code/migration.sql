-- Mobile numbers kept the way Prime ERP keeps them: the country code and the number in one run with no spaces,
-- e.g. +201012345678. Spaces, dashes and brackets are removed; a leading 00 becomes +, and a leading single 0 (an
-- Egyptian number as dialled, 010 …) becomes +20 without that 0. A number already starting with + keeps its digits;
-- anything else is left as it is.
UPDATE "employees"
SET
  "mobile" = regexp_replace(regexp_replace(regexp_replace("mobile", '[[:space:]()-]', '', 'g'), '^00', '+'), '^0([1-9])', '+20\1'),
  "mobile2" = regexp_replace(regexp_replace(regexp_replace("mobile2", '[[:space:]()-]', '', 'g'), '^00', '+'), '^0([1-9])', '+20\1'),
  "emergency_mobile" = regexp_replace(regexp_replace(regexp_replace("emergency_mobile", '[[:space:]()-]', '', 'g'), '^00', '+'), '^0([1-9])', '+20\1')
WHERE "mobile" IS NOT NULL OR "mobile2" IS NOT NULL OR "emergency_mobile" IS NOT NULL;
