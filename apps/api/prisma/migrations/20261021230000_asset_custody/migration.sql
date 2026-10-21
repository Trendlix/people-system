-- Assets, step 3: custody (owner, 21 October 2026: the "Asset Register" spec's custody, built the People System's way:
-- "use the main ERP system specs .. dont stick to the MD file"; "Yes, My custody"; "Record it; HR decides a deduction").
-- The custody tables were made with the register (20261021120000_assets); this adds what the flows keep besides. The
-- rules: packages/shared custody.ts; the module: apps/api/src/assets.
--
-- 1. The terms printed on the custody forms, as an Assets manager writes them in Assets → Settings; none: the standard
--    wording (CUSTODY_TERMS_STANDARD). Each record keeps a snapshot of the terms it was printed with (custody_records.terms).
-- 2. A record's "Handed over by" as written on the form (the signed-in person unless changed), and the daily check's
--    notices: the last day the employee and the custodians were told a shoot's return is overdue (one a day), and when
--    the custodians were told its signed copy is still not attached 3 days on (once).
-- 3. What made a maintenance entry, when the register did: sent to repair, back from repair, returned damaged on a
--    custody record ("Returned damaged on CUS-xxxx by {name}").
-- 4. A Damage or loss deduction HR makes from an item returned damaged or missing, linked to its custody item (never
--    made by itself).
-- 5. The notifications of custody: the employee's handover and returns, an overdue shoot, a record not signed.

-- 1.
ALTER TABLE "asset_settings" ADD COLUMN "custody_terms" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 2.
ALTER TABLE "custody_records" ADD COLUMN "handed_over_by_name" TEXT,
ADD COLUMN "overdue_notice_on" DATE,
ADD COLUMN "unsigned_notice_at" TIMESTAMPTZ;

-- 3.
ALTER TABLE "asset_maintenance" ADD COLUMN "event" TEXT;
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_event_check" CHECK ("event" IS NULL OR "event" IN ('sent_to_repair', 'back_from_repair', 'returned_damaged'));

-- 4.
ALTER TABLE "payroll_adjustments" ADD COLUMN "custody_item_id" UUID;
-- only a Damage or loss deduction is linked to a custody item
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_custody_item_check" CHECK ("custody_item_id" IS NULL OR ("kind" = 'deduction' AND "type" = 'damage_loss'));

CREATE INDEX "payroll_adjustments_custody_item_id_idx" ON "payroll_adjustments"("custody_item_id");

ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_custody_item_id_fkey" FOREIGN KEY ("custody_item_id") REFERENCES "custody_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN (
    'leave_waiting', 'leave_decided', 'permission_waiting', 'permission_decided',
    'reimbursement_waiting', 'reimbursement_decided', 'reimbursement_paid',
    'correction_waiting', 'correction_decided',
    'raise_request_waiting', 'pay_raise_waiting', 'pay_raise_decided',
    'payslip_issued', 'home_location_waiting', 'home_location_decided',
    'check_in_reminder', 'check_out_reminder',
    'kpi_self_rating', 'kpi_waiting', 'kpi_ready_to_sign',
    'wfh_waiting', 'wfh_decided',
    'custody_handover', 'custody_return', 'custody_overdue', 'custody_unsigned'
));
