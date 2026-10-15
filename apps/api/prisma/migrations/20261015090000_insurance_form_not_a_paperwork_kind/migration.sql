-- Social insurance Form 1 is no longer a kind of paperwork (owner, 15 October 2026): like the bank account letter, the
-- system generates the social insurance forms from templates HR adds; they are not scans HR collects. A file already
-- uploaded as one stays in the employee file, as an Other document.
UPDATE "paperwork_items" SET "kind" = 'other' WHERE "kind" = 'insurance_form_1';
