-- Egyptian national ID cards have no issuing office (owner, 15 October 2026), so it is no longer read from the card or
-- learned from HR's corrections. Fixes learned for it are removed. The employee_identity.issuing_office column stays,
-- so nothing already typed in is lost.
DELETE FROM "ocr_corrections" WHERE "field" = 'issuingOffice';
