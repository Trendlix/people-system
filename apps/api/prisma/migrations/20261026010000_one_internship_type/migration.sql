-- One internship type (owner, 25 October 2026: "unpaid internship and training are the same thing .. keep the unpaid
-- internship with its document and delete the trainee with its documents"). The paid trainee (المتدرج, Labour Law
-- 14/2025 Arts. 28–30: a training agreement with training stages and rising pay) is taken out; the unpaid internship
-- (intern) stays, with its documents and its rules: no probation, renewed once, then converted to full-time, and a new
-- agreement only 6 months after the last one ended. The rules: packages/shared employment-types.ts.
--
-- 1. The audit log first, while the records still say trainee: one entry per record changed, by the system (no user),
--    with the reason, as 20261017030000 recorded its clean-up of bank details. A contract's training stages hold its
--    pay, so the log says only that they changed, as for a contract's other salary fields.
-- 2. Every employment, job offer and vacancy of type trainee becomes intern, and the payroll lines' copy of the type with
--    them (a copy, not audited, as 20261017030000 cleaned the payroll lines' bank copies). Postgres can't drop an enum's
--    value, so the type is made again without trainee (as 20261018190000 and 20261019170000 did) and each column using
--    it is cast; the checks naming it are made again.
-- 3. The training stages go: the contracts' column and its check, and the conversion's check made again without it.
--    The gross stays as recorded.
-- 4. Who may claim a reimbursement type: intern in place of trainee, each type once, and its check made again.
-- 5. The trainee's template slots, contract_trainee and offer_trainee: a version no generated document and no job offer
--    was filled in from is deleted; the others are kept as records, retired (the library lists neither: packages/shared
--    RETIRED_SLOT_NAMES). The generated documents stay as they are. The training stages tags (trainee_stages, _ar and
--    _en) left the dictionary: a version of another slot that has one keeps it among its unknown tags, so it isn't
--    published again until HR uploads one without it.
-- 6. The ending rule Training completed: an intern's internship agreement now, not the law's training agreement.

-- tables for this script only (Prisma runs a migration outside a transaction, so ON COMMIT DROP would drop them at once)
CREATE TEMP TABLE one_internship_reason AS
SELECT 'One internship type (owner, 25 October 2026: "unpaid internship and training are the same thing"): the trainee became an unpaid internship'::TEXT AS "text";

CREATE TEMP TABLE trainee_versions AS
SELECT v."id", v."slot_key", v."version", v."file_name", v."status",
  (EXISTS (SELECT 1 FROM "generated_documents" d WHERE d."template_version_id" = v."id")
    OR EXISTS (SELECT 1 FROM "job_offers" o WHERE o."template_version_id" = v."id")) AS "on_record"
FROM "template_versions" v
WHERE v."slot_key" IN ('contract_trainee', 'offer_trainee');

CREATE TEMP TABLE reimbursement_types_mapped AS
SELECT r."id", r."employment_types" AS "before", (
    SELECT COALESCE(array_agg(m."type" ORDER BY m."first"), ARRAY[]::TEXT[])
    FROM (
        SELECT CASE u."type" WHEN 'trainee' THEN 'intern' ELSE u."type" END AS "type", min(u."n") AS "first"
        FROM unnest(r."employment_types") WITH ORDINALITY AS u("type", "n")
        GROUP BY 1
    ) m
) AS "after"
FROM "reimbursement_types" r
WHERE 'trainee' = ANY (r."employment_types");

-- 1.
INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'update', 'employment', e."id", jsonb_build_object(
  'employmentType', jsonb_build_object('from', 'trainee', 'to', 'intern'),
  'reason', (SELECT "text" FROM one_internship_reason)
)
FROM "employments" e
WHERE e."employment_type" = 'trainee'
ORDER BY e."id";

INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'update', 'contract', c."id", jsonb_build_object(
  'traineeStages', 'changed',
  'reason', (SELECT "text" FROM one_internship_reason) || ', its training stages removed (the gross stays as recorded)'
)
FROM "contracts" c
WHERE c."trainee_stages" IS NOT NULL
ORDER BY c."id";

INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'update', 'job_offer', o."id", jsonb_build_object(
  'employmentType', jsonb_build_object('from', 'trainee', 'to', 'intern'),
  'reason', (SELECT "text" FROM one_internship_reason)
)
FROM "job_offers" o
WHERE o."employment_type" = 'trainee'
ORDER BY o."id";

INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'update', 'vacancy', v."id", jsonb_build_object(
  'employmentType', jsonb_build_object('from', 'trainee', 'to', 'intern'),
  'reason', (SELECT "text" FROM one_internship_reason)
)
FROM "vacancies" v
WHERE v."employment_type" = 'trainee'
ORDER BY v."id";

INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'update', 'reimbursement_type', m."id", jsonb_build_object(
  'employmentTypes', jsonb_build_object('from', to_jsonb(m."before"), 'to', to_jsonb(m."after")),
  'reason', (SELECT "text" FROM one_internship_reason)
)
FROM reimbursement_types_mapped m
ORDER BY m."id";

INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'delete', 'template_version', t."id", jsonb_build_object(
  'slotKey', t."slot_key",
  'version', t."version",
  'fileName', t."file_name",
  'reason', (SELECT "text" FROM one_internship_reason) || ': the trainee''s template, with nothing made from it'
)
FROM trainee_versions t
WHERE NOT t."on_record"
ORDER BY t."id";

INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'update', 'template_version', t."id", jsonb_build_object(
  'slotKey', t."slot_key",
  'version', t."version",
  'status', jsonb_build_object('from', t."status", 'to', 'retired'),
  'reason', (SELECT "text" FROM one_internship_reason) || ': the trainee''s template, kept for the documents or offers made from it'
)
FROM trainee_versions t
WHERE t."on_record" AND t."status" <> 'retired'
ORDER BY t."id";

INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'update', 'template_version', v."id", jsonb_build_object(
  'slotKey', v."slot_key",
  'version', v."version",
  'unknownTags', jsonb_build_object(
    'from', to_jsonb(v."unknown_tags"),
    'to', to_jsonb(v."unknown_tags" || ARRAY(SELECT t FROM unnest(v."tags") t WHERE t IN ('trainee_stages', 'trainee_stages_ar', 'trainee_stages_en')))
  ),
  'reason', (SELECT "text" FROM one_internship_reason) || ': the training stages tags left the dictionary'
)
FROM "template_versions" v
WHERE v."slot_key" NOT IN ('contract_trainee', 'offer_trainee')
  AND v."tags" && ARRAY['trainee_stages', 'trainee_stages_ar', 'trainee_stages_en']::TEXT[]
ORDER BY v."id";

INSERT INTO "audit_log" ("action", "entity_type", "entity_id", "diff")
SELECT 'update', 'ending_rule', NULL, jsonb_build_object(
  'key', r."key",
  'source', jsonb_build_object('from', r."source", 'to', 'The internship agreement'),
  'reason', (SELECT "text" FROM one_internship_reason)
)
FROM "ending_rules" r
WHERE r."key" = 'training_completed' AND r."source" = 'Labour Law Arts. 28–30; the internship agreement';

-- 2.
ALTER TYPE "employment_type" RENAME TO "employment_type_before_one_internship";
CREATE TYPE "employment_type" AS ENUM ('full_time', 'part_time', 'intern', 'freelance');

ALTER TABLE "employments" DROP CONSTRAINT "employments_paid_by_commission_check";
ALTER TABLE "job_offers" DROP CONSTRAINT "job_offers_paid_by_commission_check";
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_converts_to_check";

ALTER TABLE "employments" ALTER COLUMN "employment_type" TYPE "employment_type" USING (
    CASE "employment_type"::TEXT WHEN 'trainee' THEN 'intern' ELSE "employment_type"::TEXT END
)::"employment_type";
ALTER TABLE "job_offers" ALTER COLUMN "employment_type" TYPE "employment_type" USING (
    CASE "employment_type"::TEXT WHEN 'trainee' THEN 'intern' ELSE "employment_type"::TEXT END
)::"employment_type";
ALTER TABLE "vacancies" ALTER COLUMN "employment_type" TYPE "employment_type" USING (
    CASE "employment_type"::TEXT WHEN 'trainee' THEN 'intern' ELSE "employment_type"::TEXT END
)::"employment_type";
ALTER TABLE "payroll_lines" ALTER COLUMN "employment_type" TYPE "employment_type" USING (
    CASE "employment_type"::TEXT WHEN 'trainee' THEN 'intern' ELSE "employment_type"::TEXT END
)::"employment_type";
-- a conversion is to full-time only (its check, below)
ALTER TABLE "contracts" ALTER COLUMN "converts_to" TYPE "employment_type" USING ("converts_to"::TEXT::"employment_type");

DROP TYPE "employment_type_before_one_internship";

ALTER TABLE "employments" ADD CONSTRAINT "employments_paid_by_commission_check" CHECK (NOT "paid_by_commission" OR "employment_type" = 'full_time');
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_paid_by_commission_check" CHECK (NOT "paid_by_commission" OR "employment_type" = 'full_time');

-- 3.
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_trainee_stages_check";
ALTER TABLE "contracts" DROP COLUMN "trainee_stages";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_converts_to_check" CHECK (
    "converts_to" IS NULL OR ("converts_to" = 'full_time' AND "kind" = 'contract' AND "version" > 1)
);

-- 4.
ALTER TABLE "reimbursement_types" DROP CONSTRAINT "reimbursement_types_employment_types_check";
UPDATE "reimbursement_types" r SET "employment_types" = m."after"
FROM reimbursement_types_mapped m
WHERE r."id" = m."id";
ALTER TABLE "reimbursement_types" ADD CONSTRAINT "reimbursement_types_employment_types_check" CHECK ("employment_types" <@ ARRAY['full_time', 'part_time', 'intern', 'freelance']::TEXT[]);

-- 5.
DELETE FROM "template_versions" v
USING trainee_versions t
WHERE v."id" = t."id" AND NOT t."on_record";

UPDATE "template_versions" v SET "status" = 'retired'
FROM trainee_versions t
WHERE v."id" = t."id" AND t."on_record" AND v."status" <> 'retired';

UPDATE "template_versions" v SET
  "unknown_tags" = v."unknown_tags" || ARRAY(SELECT t FROM unnest(v."tags") t WHERE t IN ('trainee_stages', 'trainee_stages_ar', 'trainee_stages_en')),
  "tags" = ARRAY(SELECT t FROM unnest(v."tags") t WHERE t NOT IN ('trainee_stages', 'trainee_stages_ar', 'trainee_stages_en'))
WHERE v."slot_key" NOT IN ('contract_trainee', 'offer_trainee')
  AND v."tags" && ARRAY['trainee_stages', 'trainee_stages_ar', 'trainee_stages_en']::TEXT[];

-- 6.
UPDATE "ending_rules" SET "source" = 'The internship agreement', "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'training_completed' AND "source" = 'Labour Law Arts. 28–30; the internship agreement';

DROP TABLE one_internship_reason;
DROP TABLE trainee_versions;
DROP TABLE reimbursement_types_mapped;
