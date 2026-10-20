-- Check-ins locked to the office network (owner, 20 October 2026: "allow me to lock checkin's to wifi name or ip,
-- whatever is right"): the office's public addresses and the switch "Lock check-ins to the office network" on the payroll
-- settings' row (edited on Attendance → Check-in Setup); "Can check in from anywhere" on an employment (HR's exemption
-- for an Office employee); and, on a punch, the name of the office network it came from. No employee's address is
-- kept anywhere: not on the punch, not on the day, not in the audit log.

ALTER TABLE "payroll_settings"
  ADD COLUMN "office_networks" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "office_network_lock" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "employments" ADD COLUMN "check_in_anywhere" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "attendance_punches" ADD COLUMN "office_network" TEXT;
