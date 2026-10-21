-- The main office and its sub-locations (owner, 20 October 2026, of Attendance → Check-in Setup's Check-in Locations:
-- "main office location is the hero and other locations are like sub locations. shown with their name and linked
-- users"; asked, "own sublocation shows the sub location name", "any checkin rather than the office location counts
-- remote and named with the location name (Remote - Location name)"). The rules: packages/shared sub-locations.ts.
--
-- 1. One check-in location is the main office: a check-in within it is Office, for everyone. The others are
--    sub-locations: a check-in within one is remote, kept with the sub-location's name. At most one main, by a partial
--    unique index; the API keeps one while there are any (the first added is the main, the main is removed last, and
--    "Make main" swaps it). The oldest location there is (as Check-in Setup listed them: by when it was added, then by
--    name) becomes the main.
-- 2. The people linked to a sub-location, one row a location and a person (an employee may be linked to several).
-- 3. A check-in within a sub-location the person isn't linked to is flagged 'not_their_location', for HR to check: the
--    flags allowed on the punches and the days grow by one. The places stay as they were ('remote' with the name).

-- 1.
ALTER TABLE "check_in_locations" ADD COLUMN "is_main" BOOLEAN NOT NULL DEFAULT false;

UPDATE "check_in_locations" SET "is_main" = true
WHERE "id" = (SELECT "id" FROM "check_in_locations" ORDER BY "created_at" ASC, "name" ASC, "id" ASC LIMIT 1);

CREATE UNIQUE INDEX "check_in_locations_one_main" ON "check_in_locations" ("is_main") WHERE "is_main";

-- 2.
CREATE TABLE "check_in_location_people" (
    "location_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_in_location_people_pkey" PRIMARY KEY ("location_id", "employee_id")
);

CREATE INDEX "check_in_location_people_employee_id_idx" ON "check_in_location_people"("employee_id");

ALTER TABLE "check_in_location_people" ADD CONSTRAINT "check_in_location_people_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "check_in_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "check_in_location_people" ADD CONSTRAINT "check_in_location_people_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3.
ALTER TABLE "attendance_days" DROP CONSTRAINT "attendance_days_flags_check";
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_flags_check" CHECK ("flags" <@ ARRAY['outside_office', 'location_unknown', 'fake_gps', 'not_home_or_office', 'not_their_location']::TEXT[]);

ALTER TABLE "attendance_punches" DROP CONSTRAINT "attendance_punches_flags_check";
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_flags_check" CHECK ("flags" <@ ARRAY['outside_office', 'location_unknown', 'fake_gps', 'not_home_or_office', 'not_their_location']::TEXT[]);
