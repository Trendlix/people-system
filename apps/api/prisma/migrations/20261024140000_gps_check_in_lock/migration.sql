-- Office staff's check-ins locked to the check-in locations by GPS, and requested check-in locations (owner, 24 October
-- 2026: "while these aare not checked, people can still check in and out from anywhere"; asked, "Yes, add a GPS lock
-- too"; then "allow the employee to request adding this location to his profile ... (Home Location - Remote Site -
-- Client Location) with a comment reason", "HR → CEO for all three", "allow the HR to add an end date or lik it to the
-- contract date. if renewed renew the due date of the checkin location", and "location to be allowed only to the
-- requested employee not all of them if home or remote, all employees if a customer location"). The rules:
-- packages/shared gps-lock.ts and home-locations.ts. Written by hand.

-- 1. The switch "Refuse Office staff's check-ins and check-outs outside the check-in locations", off to start with, and
--    the accuracy past which a reading is too rough to tell (200 m to start with; HR sets 50 to 500 m).
ALTER TABLE "payroll_settings"
  ADD COLUMN "gps_lock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gps_rough_metres" INTEGER NOT NULL DEFAULT 200,
  ADD CONSTRAINT "payroll_settings_gps_rough_check" CHECK ("gps_rough_metres" BETWEEN 50 AND 500);

-- 2. A home location request is one of three types; a remote site's and a client location's name is the label (required
--    there, checked by the API); the employee's reason (required since; those of before have none), the end date they
--    wished, its validity (until a date, until the contract ends, or no end), the date it lasts until, the day the notice
--    of its end was sent, and the company check-in location a client location became.
ALTER TABLE "home_location_requests"
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'home',
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "wished_end_date" DATE,
  ADD COLUMN "validity" TEXT,
  ADD COLUMN "valid_until" DATE,
  ADD COLUMN "ending_notice_on" DATE,
  ADD COLUMN "location_id" UUID,
  ADD CONSTRAINT "home_location_requests_type_check" CHECK ("type" IN ('home', 'remote_site', 'client')),
  ADD CONSTRAINT "home_location_requests_reason_check" CHECK ("reason" IS NULL OR length(btrim("reason")) BETWEEN 1 AND 1000),
  ADD CONSTRAINT "home_location_requests_wished_check" CHECK ("wished_end_date" IS NULL OR "type" <> 'home'),
  ADD CONSTRAINT "home_location_requests_validity_check" CHECK (
    ("validity" IS NULL OR "validity" IN ('until_date', 'contract', 'no_end'))
    AND (("validity" = 'until_date') = ("valid_until" IS NOT NULL))
  );

ALTER TABLE "home_location_requests" ADD CONSTRAINT "home_location_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "check_in_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The homes approved before keep working as they did: no end (HR may give one a date or link it to the contract).
UPDATE "home_location_requests" SET "validity" = 'no_end' WHERE "status" = 'approved';

-- A step HR takes later: the validity changed.
ALTER TABLE "home_location_steps" DROP CONSTRAINT "home_location_steps_kind_check";
ALTER TABLE "home_location_steps" ADD CONSTRAINT "home_location_steps_kind_check" CHECK ("kind" IN ('submitted', 'hr_decision', 'ceo_decision', 'withdrawn', 'replaced', 'removed', 'validity_changed'));

-- 3. A check-in location is the office's (the main office and its sub-locations, as before) or a client location,
--    everyone's, never the main office; a client location lasts until valid_until (none: no end) unless HR ends it.
ALTER TABLE "check_in_locations"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'office',
  ADD COLUMN "valid_until" DATE,
  ADD COLUMN "ended_at" TIMESTAMPTZ,
  ADD COLUMN "ending_notice_on" DATE,
  ADD CONSTRAINT "check_in_locations_kind_check" CHECK ("kind" IN ('office', 'client')),
  ADD CONSTRAINT "check_in_locations_client_check" CHECK ("kind" = 'client' OR ("valid_until" IS NULL AND "ended_at" IS NULL)),
  ADD CONSTRAINT "check_in_locations_client_main_check" CHECK ("kind" = 'office' OR NOT "is_main");

-- 4. A press within a client location or the person's remote site says which ("Client · Acme", "Remote site · Flat").
ALTER TABLE "attendance_punches"
  ADD COLUMN "location_kind" TEXT,
  ADD CONSTRAINT "attendance_punches_location_kind_check" CHECK ("location_kind" IS NULL OR "location_kind" IN ('remote_site', 'client'));

-- 5. The notice (packages/shared notifications.ts): a check-in location's end coming in 7 days. Every kind kept: those of
--    20261024110000_meeting_providers, the screening comments' mention (20261024120000), then this one.
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
    'custody_handover', 'custody_return', 'custody_overdue', 'custody_unsigned',
    'offboarding_items', 'offboarding_cleared', 'exit_interview',
    'vacancy_waiting', 'vacancy_decided', 'applications_new',
    'interview_scheduled', 'interview_feedback', 'hiring_suggestion', 'onboarding_items',
    'access_hold', 'access_grace', 'access_grace_ending', 'access_held',
    'od_waiting', 'od_decided',
    'access_no_contract',
    'meeting_connection',
    'screening_mention',
    'check_in_location_ending'
));
