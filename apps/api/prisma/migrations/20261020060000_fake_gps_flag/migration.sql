-- Fake GPS suspected (the employee app, Phase 2; owner, 20 October 2026: "Android mock location → mock: true on the
-- punch → flagged ("Fake GPS suspected") on Daily Attendance"; apps/mobile/README.md). A press whose location the
-- phone said is a mock one is kept like any other (never its coordinates) and flagged 'fake_gps', on the punch and on
-- the day it makes: the flags allowed grow by one (packages/shared check-in.ts, CHECK_IN_FLAGS).

ALTER TABLE "attendance_days" DROP CONSTRAINT "attendance_days_flags_check";
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_flags_check" CHECK ("flags" <@ ARRAY['outside_office', 'location_unknown', 'fake_gps']::TEXT[]);

ALTER TABLE "attendance_punches" DROP CONSTRAINT "attendance_punches_flags_check";
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_flags_check" CHECK ("flags" <@ ARRAY['outside_office', 'location_unknown', 'fake_gps']::TEXT[]);
