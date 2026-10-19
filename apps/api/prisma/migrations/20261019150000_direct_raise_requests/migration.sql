-- Every raise on Raise Requests (owner, 19 October 2026: "when a raise request was sent to the CEO, is showed in
-- approvals not raise requests, and after approved, it was not shown in the raise request history too"). A raise HR
-- prepared directly (on the contract in force, or a renewal with new pay) had no raise request: it reached the CEO on
-- Approvals only and, once approved, showed only in the employee's Salary History. Now every version with the CEO's step
-- has its request, one prepared directly by HR when nobody asked for it, following its raise as an asked one does.
--
-- 1. Where a request came from: asked for, or prepared directly by HR (always by HR; its raise's reason, adjustment too,
--    and its raise's effective date, a renewal's start that may not be a 1st).
-- 2. The versions with the CEO's step and no request until now, each given one prepared directly by HR: by whoever
--    entered it (the audit log), its reason, its note as the comment (else "Prepared directly by HR"), the raise as
--    suggested (the increase in the gross over the version before, when it goes up, and the gross), from its effective
--    date; where it stands as an asked one would: a draft or a returned one with HR, one sent with the CEO, one the CEO
--    approved approved, one signed done (when it was signed). A raise the CEO rejected was deleted with its draft: there
--    is nothing left of it to give a request.
-- 3. Their steps, as far as they are known, by whom when the audit log says: prepared when the version was entered;
--    sent when it was last sent; returned when the CEO returned it and it hasn't been sent since; the CEO's approval
--    (with another raise when the audit log says so, and the CEO's comment); signed.
-- 4. The CEO may change the reason when approving (owner, 19 October 2026: "when approving a raise as a ceo, i might want
--    to ammend the raise reason, not only the money"): the CEO's decision logs the reason it had before with the new one.

-- 1.
ALTER TABLE "raise_requests" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'request',
  ADD CONSTRAINT "raise_requests_origin_check" CHECK ("origin" IN ('request', 'direct') AND ("origin" = 'request' OR "requester" = 'hr')),
  DROP CONSTRAINT "raise_requests_raise_reason_check",
  ADD CONSTRAINT "raise_requests_raise_reason_check" CHECK (
    "raise_reason" IN ('annual', 'performance', 'counter_offer', 'promotion', 'market_adjustment', 'cost_of_living', 'other')
    OR ("origin" = 'direct' AND "raise_reason" = 'adjustment')
  ),
  DROP CONSTRAINT "raise_requests_effective_from_check",
  ADD CONSTRAINT "raise_requests_effective_from_check" CHECK ("effective_from" IS NULL OR EXTRACT(DAY FROM "effective_from") = 1 OR "origin" = 'direct');

-- 2.
INSERT INTO "raise_requests" (
  "id", "employee_id", "employment_id", "requested_by", "requester", "origin", "raise_reason", "comment",
  "suggested_increase", "suggested_gross", "effective_from", "status", "contract_id", "done_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), e."employee_id", c."employment_id", made."user_id", 'hr', 'direct', c."raise_reason",
  COALESCE(NULLIF(btrim(c."note"), ''), 'Prepared directly by HR'),
  CASE WHEN c."gross_salary" > p."gross_salary" THEN c."gross_salary" - p."gross_salary" END,
  c."gross_salary", c."start_date",
  CASE WHEN c."status" <> 'draft' THEN 'done' WHEN c."approval" = 'pending_ceo' THEN 'with_ceo' WHEN c."approval" = 'approved' THEN 'approved' ELSE 'with_hr' END,
  c."id",
  CASE WHEN c."status" <> 'draft' THEN COALESCE(signed."at", c."updated_at") END,
  c."created_at", now()
FROM "contracts" c
JOIN "employments" e ON e."id" = c."employment_id"
LEFT JOIN "contracts" p ON p."employment_id" = c."employment_id" AND p."version" = c."version" - 1
LEFT JOIN LATERAL (
  SELECT a."user_id" FROM "audit_log" a WHERE a."entity_type" = 'contract' AND a."entity_id" = c."id" AND a."action" = 'create' ORDER BY a."id" LIMIT 1
) made ON true
LEFT JOIN LATERAL (
  SELECT a."at" FROM "audit_log" a WHERE a."entity_type" = 'contract' AND a."entity_id" = c."id" AND a."action" = 'sign' ORDER BY a."id" DESC LIMIT 1
) signed ON true
WHERE c."approval" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "raise_requests" r WHERE r."contract_id" = c."id");

-- 3. In order within each request: by when, then as the raise goes (prepared, sent, returned, approved, signed).
INSERT INTO "raise_request_steps" (
  "request_id", "kind", "decision", "raise_reason", "comment", "increase_amount", "increase_percent", "gross", "way",
  "effective_date", "contract_number", "actor_id", "at"
)
SELECT "request_id", "kind", "decision", "raise_reason", "comment", "increase_amount", "increase_percent", "gross", "way",
  "effective_date", "contract_number", "actor_id", "at"
FROM (
  WITH direct AS (
    SELECT r."id" AS "request_id", r."requested_by", r."comment", r."done_at", c.*,
      c."gross_salary" - p."gross_salary" AS "increase",
      CASE WHEN p."gross_salary" > 0 THEN round((c."gross_salary" - p."gross_salary") / p."gross_salary" * 100, 2) END AS "increase_pct"
    FROM "raise_requests" r
    JOIN "contracts" c ON c."id" = r."contract_id"
    LEFT JOIN "contracts" p ON p."employment_id" = c."employment_id" AND p."version" = c."version" - 1
    WHERE r."origin" = 'direct'
  )
  -- prepared: by whoever entered it, with its reason, the comment, the raise and how it is made
  SELECT d."request_id", 'prepared' AS "kind", NULL AS "decision", d."raise_reason", d."comment", d."increase" AS "increase_amount",
    d."increase_pct" AS "increase_percent", d."gross_salary" AS "gross",
    CASE d."kind" WHEN 'amendment' THEN 'amendment' ELSE 'contract' END AS "way",
    d."start_date" AS "effective_date", d."number" AS "contract_number", d."requested_by" AS "actor_id", d."created_at" AS "at", 0 AS "n"
  FROM direct d

  UNION ALL
  -- sent to the CEO, the last time
  SELECT d."request_id", 'sent', NULL, NULL, NULL, NULL, NULL, d."gross_salary", NULL, NULL, d."number", sent."user_id", d."sent_at", 1
  FROM direct d
  LEFT JOIN LATERAL (
    SELECT a."user_id" FROM "audit_log" a WHERE a."entity_type" = 'contract' AND a."entity_id" = d."id" AND a."action" = 'submit' ORDER BY a."id" DESC LIMIT 1
  ) sent ON true
  WHERE d."sent_at" IS NOT NULL

  UNION ALL
  -- returned to HR, not sent since: with the CEO's comment
  SELECT d."request_id", 'returned', NULL, NULL, d."returned_reason", NULL, NULL, NULL, NULL, NULL, d."number", ret."user_id",
    COALESCE(ret."at", d."updated_at"), 2
  FROM direct d
  LEFT JOIN LATERAL (
    SELECT a."user_id", a."at" FROM "audit_log" a WHERE a."entity_type" = 'contract' AND a."entity_id" = d."id" AND a."action" = 'return' ORDER BY a."id" DESC LIMIT 1
  ) ret ON true
  WHERE d."approval" = 'draft' AND d."returned_reason" IS NOT NULL

  UNION ALL
  -- the CEO's approval, as the audit log has it since 17 October 2026 (with another raise, and the comment)
  SELECT d."request_id", 'ceo_decision', CASE WHEN ap."diff"->>'decision' = 'approve_other' THEN 'approve_other' ELSE 'approve' END, NULL,
    ap."diff"->>'comment', d."increase", d."increase_pct", d."gross_salary", NULL, NULL, d."number", d."approved_by", d."approved_at", 3
  FROM direct d
  LEFT JOIN LATERAL (
    SELECT a."diff" FROM "audit_log" a WHERE a."entity_type" = 'contract' AND a."entity_id" = d."id" AND a."action" = 'approve' ORDER BY a."id" DESC LIMIT 1
  ) ap ON true
  WHERE d."approved_at" IS NOT NULL

  UNION ALL
  -- signed: the request is done
  SELECT d."request_id", 'signed', NULL, NULL, NULL, NULL, NULL, d."gross_salary", NULL, d."start_date", d."number", sig."user_id", d."done_at", 4
  FROM direct d
  LEFT JOIN LATERAL (
    SELECT a."user_id" FROM "audit_log" a WHERE a."entity_type" = 'contract' AND a."entity_id" = d."id" AND a."action" = 'sign' ORDER BY a."id" DESC LIMIT 1
  ) sig ON true
  WHERE d."status" <> 'draft'
) s
ORDER BY "request_id", "at", "n";

-- 4.
ALTER TABLE "raise_request_steps" ADD COLUMN "raise_reason_from" TEXT,
  ADD CONSTRAINT "raise_request_steps_raise_reason_from_check" CHECK ("raise_reason_from" IS NULL OR ("kind" = 'ceo_decision' AND "raise_reason" IS NOT NULL));
