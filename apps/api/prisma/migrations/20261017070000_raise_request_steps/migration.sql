-- Raise requests reworked (owner, 17 October 2026: "requesting a raise should have a drop list reason first ( Annual
-- Raise - Performance Raise - Counter Offer Raise - etc..) then add requester comment, suggest raise amount or
-- percentage, then the approver to Approve - Approve with another raise amount or percentge - Reject, and add a
-- comment, all the request steps to be logged in the request").
--
-- 1. Why the pay changes, on a raise and a request alike: annual, performance, counter-offer, promotion, market
-- adjustment, cost of living, other. Adjustment stays for the versions that have it from before.
-- 2. A request: the reason from the list (none on a request from before), the requester's comment (the reason written
-- until now), and the suggested raise, an amount added to the gross or a percent of it, one or the other, with the
-- gross it came to. A manager doesn't see salaries: a percent only.
-- 3. Each step of a request, logged on it in order: submitted, HR's decision, the raise prepared, sent to the CEO, the
-- CEO's decision, returned to HR, changed after its approval, signed, a signing undone, the raise draft deleted.
-- 4. The steps of the requests asked for until now, as far as they are known: each submitted, from the request; then
-- what the audit log recorded of each (prepared, sent, the CEO's approval, returns, declines, signed, a signing
-- undone), with who and when; for a request the audit log has nothing more of, what the request and its raise say
-- (prepared, approved, declined, signed). The amounts decided until now were not logged: those steps have none.

-- 1.
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_raise_reason_check",
  ADD CONSTRAINT "contracts_raise_reason_check" CHECK ("raise_reason" IN ('annual', 'performance', 'counter_offer', 'promotion', 'market_adjustment', 'cost_of_living', 'adjustment', 'other'));

-- 2.
ALTER TABLE "raise_requests" RENAME COLUMN "reason" TO "comment";
ALTER TABLE "raise_requests" RENAME CONSTRAINT "raise_requests_reason_check" TO "raise_requests_comment_check";
ALTER TABLE "raise_requests" DROP CONSTRAINT "raise_requests_suggested_gross_check",
  ADD COLUMN "raise_reason" TEXT,
  ADD COLUMN "suggested_increase" DECIMAL(12,2),
  ADD COLUMN "suggested_percent" DECIMAL(5,2),
  ADD CONSTRAINT "raise_requests_raise_reason_check" CHECK ("raise_reason" IN ('annual', 'performance', 'counter_offer', 'promotion', 'market_adjustment', 'cost_of_living', 'other')),
  -- an amount or a percent, not both; a percent up to 100
  ADD CONSTRAINT "raise_requests_suggestion_check" CHECK (
    ("suggested_increase" IS NULL OR "suggested_percent" IS NULL)
    AND ("suggested_increase" IS NULL OR "suggested_increase" > 0)
    AND ("suggested_percent" IS NULL OR ("suggested_percent" > 0 AND "suggested_percent" <= 100))
    AND ("suggested_gross" IS NULL OR "suggested_gross" > 0)
  ),
  -- a manager suggests a percent only, and the gross it came to (for HR) only from one
  ADD CONSTRAINT "raise_requests_manager_suggestion_check" CHECK (
    "requester" <> 'manager' OR ("suggested_increase" IS NULL AND ("suggested_gross" IS NULL OR "suggested_percent" IS NOT NULL))
  );

-- 3.
CREATE TABLE "raise_request_steps" (
    "id" BIGSERIAL NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT,
    "raise_reason" TEXT,
    "comment" TEXT,
    "figure" TEXT,
    "increase_amount" DECIMAL(12,2),
    "increase_percent" DECIMAL(7,2),
    "gross" DECIMAL(12,2),
    "way" TEXT,
    "effective_date" DATE,
    "contract_number" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raise_request_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "raise_request_steps_kind_check" CHECK ("kind" IN ('submitted', 'hr_decision', 'prepared', 'sent', 'ceo_decision', 'returned', 'changed', 'signed', 'unsigned', 'raise_deleted')),
    -- HR's and the CEO's decisions, and only they, have their decision
    CONSTRAINT "raise_request_steps_decision_check" CHECK (("decision" IS NOT NULL) = ("kind" IN ('hr_decision', 'ceo_decision')) AND ("decision" IS NULL OR "decision" IN ('approve', 'approve_other', 'reject'))),
    CONSTRAINT "raise_request_steps_figure_check" CHECK ("figure" IS NULL OR "figure" IN ('amount', 'percent')),
    CONSTRAINT "raise_request_steps_way_check" CHECK ("way" IS NULL OR "way" IN ('amendment', 'contract'))
);

CREATE INDEX "raise_request_steps_request_id_idx" ON "raise_request_steps"("request_id");

ALTER TABLE "raise_request_steps" ADD CONSTRAINT "raise_request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "raise_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raise_request_steps" ADD CONSTRAINT "raise_request_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. In order within each request: by when, then as recorded (the request first, then the audit log's entries in turn).
INSERT INTO "raise_request_steps" ("request_id", "kind", "decision", "comment", "gross", "way", "effective_date", "contract_number", "actor_id", "at")
SELECT "request_id", "kind", "decision", "comment", "gross", "way", "effective_date", "contract_number", "actor_id", "at"
FROM (
  -- submitted: by whom, when, the reason written (now the comment) and the gross suggested
  SELECT r."id" AS "request_id", 'submitted' AS "kind", NULL AS "decision", r."comment", r."suggested_gross" AS "gross",
    NULL AS "way", NULL::DATE AS "effective_date", NULL AS "contract_number", r."requested_by" AS "actor_id", r."created_at" AS "at", 0::BIGINT AS "n"
  FROM "raise_requests" r

  UNION ALL
  -- what the audit log recorded on the request
  SELECT r."id",
    CASE a."action"
      WHEN 'prepare' THEN 'prepared'
      WHEN 'submit' THEN 'sent'
      WHEN 'approve' THEN 'ceo_decision'
      WHEN 'return' THEN 'returned'
      WHEN 'decline' THEN CASE WHEN a."diff"->>'stage' = 'ceo' THEN 'ceo_decision' ELSE 'hr_decision' END
      WHEN 'done' THEN 'signed'
      ELSE 'unsigned'
    END,
    CASE a."action" WHEN 'approve' THEN 'approve' WHEN 'decline' THEN 'reject' END,
    CASE WHEN a."action" IN ('return', 'decline') THEN a."diff"->>'reason' END,
    NULL,
    -- the way and the date of the raise prepared, while it is still there
    CASE WHEN a."action" = 'prepare' AND c."id" IS NOT NULL THEN CASE c."kind" WHEN 'amendment' THEN 'amendment' ELSE 'contract' END END,
    CASE WHEN a."action" IN ('prepare', 'done') THEN c."start_date" END,
    a."diff"->>'contract',
    a."user_id",
    a."at",
    a."id"
  FROM "audit_log" a
  JOIN "raise_requests" r ON r."id" = a."entity_id"
  LEFT JOIN "contracts" c ON c."id" = r."contract_id" AND c."number" = a."diff"->>'contract'
  WHERE a."entity_type" = 'raise_request'
    AND (a."action" IN ('prepare', 'submit', 'approve', 'return', 'decline', 'done') OR (a."action" = 'update' AND a."diff"->>'signingUndone' IS NOT NULL))

  UNION ALL
  -- a request the audit log has nothing more of: what it and its raise say
  SELECT r."id", 'prepared', NULL, NULL, NULL, CASE c."kind" WHEN 'amendment' THEN 'amendment' ELSE 'contract' END, c."start_date", c."number", NULL, c."created_at", 1
  FROM "raise_requests" r JOIN "contracts" c ON c."id" = r."contract_id"
  WHERE NOT EXISTS (SELECT 1 FROM "audit_log" a WHERE a."entity_type" = 'raise_request' AND a."entity_id" = r."id" AND a."action" <> 'create')

  UNION ALL
  SELECT r."id", 'ceo_decision', 'approve', NULL, NULL, NULL, NULL, c."number", c."approved_by", c."approved_at", 2
  FROM "raise_requests" r JOIN "contracts" c ON c."id" = r."contract_id"
  WHERE c."approved_at" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "audit_log" a WHERE a."entity_type" = 'raise_request' AND a."entity_id" = r."id" AND a."action" <> 'create')

  UNION ALL
  SELECT r."id", CASE r."declined_stage" WHEN 'ceo' THEN 'ceo_decision' ELSE 'hr_decision' END, 'reject', r."decline_reason", NULL, NULL, NULL, NULL, r."declined_by", r."declined_at", 3
  FROM "raise_requests" r
  WHERE r."status" = 'declined' AND r."declined_at" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "audit_log" a WHERE a."entity_type" = 'raise_request' AND a."entity_id" = r."id" AND a."action" <> 'create')

  UNION ALL
  SELECT r."id", 'signed', NULL, NULL, NULL, NULL, c."start_date", c."number", NULL, r."done_at", 4
  FROM "raise_requests" r LEFT JOIN "contracts" c ON c."id" = r."contract_id"
  WHERE r."status" = 'done' AND r."done_at" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "audit_log" a WHERE a."entity_type" = 'raise_request' AND a."entity_id" = r."id" AND a."action" <> 'create')
) s
ORDER BY "request_id", "at", "n";
