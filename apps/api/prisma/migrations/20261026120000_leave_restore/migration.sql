-- A Super Admin undoing a cancellation (owner, 26 October 2026: "allow superadmin to undo cancellation and go through the
-- edit to prevent this mistake"): a leave's steps gain 'restored', beside those of before. The step's comment is the note.
ALTER TABLE "leave_request_steps" DROP CONSTRAINT "leave_request_steps_kind_check";
ALTER TABLE "leave_request_steps" ADD CONSTRAINT "leave_request_steps_kind_check" CHECK ("kind" IN ('submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled', 'cover_changed', 'edited', 'restored'));
