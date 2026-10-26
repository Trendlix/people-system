-- A Super Admin editing a leave (owner, 26 October 2026, on an imported approved annual leave's page: "as a superadmin i
-- need to edit the leaves"): its steps gain 'edited', beside those of before. The step's comment lists what changed.
ALTER TABLE "leave_request_steps" DROP CONSTRAINT "leave_request_steps_kind_check";
ALTER TABLE "leave_request_steps" ADD CONSTRAINT "leave_request_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled', 'cover_changed', 'edited'));
