-- The notification kinds, stated again with every one (owner, 26 October 2026). 20261026170000_resignation_requests
-- redefined notifications_kind_check from the list of before compensatory days (20261026140000_compensatory_days), so it
-- dropped compensatory_waiting and compensatory_decided. Written by hand, after both: every kind of the compensatory
-- days migration, then the two of the resignation requests. 20261026170000 is left as it is (it was applied before this
-- was found).
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
    'check_in_location_ending',
    'cv_suggestions',
    'leave_cover',
    'stand_in',
    'compensatory_waiting', 'compensatory_decided',
    'resignation_new', 'resignation_update'
));
