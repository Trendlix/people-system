-- Bank details saved before 17 October 2026 cleaned once (owner's request: "when saving iban or account number make sure
-- there is no spaces before or after the field data, and check the previous entered data"): account numbers without
-- spaces of any kind, dashes or invisible characters (zero-width spaces, direction marks …); IBANs the same, in
-- capitals; the holder's name, the bank and the branch without spaces around them, runs of spaces as one and no
-- invisible characters. As saving does from now on (apps/api/src/employees/checks.ts). An empty value becomes none.
-- Each employee whose details change gets an audit entry like a bank edit's: the numbers only as 'changed'.

-- a table for this script only (Prisma runs a migration outside a transaction, so ON COMMIT DROP would drop it at once)
CREATE TEMP TABLE bank_cleaned AS
SELECT
  employee_id,
  bank_name, NULLIF(btrim(regexp_replace(regexp_replace(bank_name, '[​-‏‪-‮⁠-⁩﻿]', '', 'g'), '[\s ]+', ' ', 'g')), '') AS bank_name_new,
  branch, NULLIF(btrim(regexp_replace(regexp_replace(branch, '[​-‏‪-‮⁠-⁩﻿]', '', 'g'), '[\s ]+', ' ', 'g')), '') AS branch_new,
  account_no, NULLIF(regexp_replace(account_no, '[\s ​-‏‪-‮⁠-⁩﻿-]', '', 'g'), '') AS account_no_new,
  iban, NULLIF(upper(regexp_replace(iban, '[\s ​-‏‪-‮⁠-⁩﻿]', '', 'g')), '') AS iban_new,
  holder_name, NULLIF(btrim(regexp_replace(regexp_replace(holder_name, '[​-‏‪-‮⁠-⁩﻿]', '', 'g'), '[\s ]+', ' ', 'g')), '') AS holder_name_new
FROM "employee_bank";

DELETE FROM bank_cleaned
WHERE bank_name IS NOT DISTINCT FROM bank_name_new
  AND branch IS NOT DISTINCT FROM branch_new
  AND account_no IS NOT DISTINCT FROM account_no_new
  AND iban IS NOT DISTINCT FROM iban_new
  AND holder_name IS NOT DISTINCT FROM holder_name_new;

INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'update', 'employee', employee_id, jsonb_build_object(
  'bank', jsonb_strip_nulls(jsonb_build_object(
    'bankName', CASE WHEN bank_name IS DISTINCT FROM bank_name_new THEN jsonb_build_object('from', bank_name, 'to', bank_name_new) END,
    'branch', CASE WHEN branch IS DISTINCT FROM branch_new THEN jsonb_build_object('from', branch, 'to', branch_new) END,
    'accountNo', CASE WHEN account_no IS DISTINCT FROM account_no_new THEN to_jsonb('changed'::text) END,
    'iban', CASE WHEN iban IS DISTINCT FROM iban_new THEN to_jsonb('changed'::text) END,
    'holderName', CASE WHEN holder_name IS DISTINCT FROM holder_name_new THEN jsonb_build_object('from', holder_name, 'to', holder_name_new) END
  )),
  'reason', 'Spaces and invisible characters removed from bank details saved before 17 October 2026'
)
FROM bank_cleaned;

UPDATE "employee_bank" b
SET "bank_name" = c.bank_name_new, "branch" = c.branch_new, "account_no" = c.account_no_new, "iban" = c.iban_new, "holder_name" = c.holder_name_new
FROM bank_cleaned c
WHERE b.employee_id = c.employee_id;

-- the copies on payroll runs (taken when the CEO approves, used by the bank files): cleaned the same way
UPDATE "payroll_lines"
SET
  "account_no" = NULLIF(regexp_replace("account_no", '[\s ​-‏‪-‮⁠-⁩﻿-]', '', 'g'), ''),
  "iban" = NULLIF(upper(regexp_replace("iban", '[\s ​-‏‪-‮⁠-⁩﻿]', '', 'g')), ''),
  "holder_name" = NULLIF(btrim(regexp_replace(regexp_replace("holder_name", '[​-‏‪-‮⁠-⁩﻿]', '', 'g'), '[\s ]+', ' ', 'g')), '')
WHERE "account_no" ~ '[\s ​-‏‪-‮⁠-⁩﻿-]'
   OR "iban" ~ '[\s ​-‏‪-‮⁠-⁩﻿]|[a-z]'
   OR "holder_name" <> btrim(regexp_replace(regexp_replace("holder_name", '[​-‏‪-‮⁠-⁩﻿]', '', 'g'), '[\s ]+', ' ', 'g'));

DROP TABLE bank_cleaned;
