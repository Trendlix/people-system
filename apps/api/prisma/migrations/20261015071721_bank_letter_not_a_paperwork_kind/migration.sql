-- The bank account letter is no longer a kind of paperwork (owner, 15 October 2026): the system generates it for the
-- employee to open a bank account, from a template HR adds later; it is not a scan HR collects. A file already uploaded
-- as one stays in the employee file, as an Other document.
UPDATE "paperwork_items" SET "kind" = 'other' WHERE "kind" = 'bank_letter';
