-- Several check-in locations (owner, 20 October 2026: "i cant find in the system where to add the eligable check in
-- locations", then "Own page, several locations"): Attendance → Check-in Setup keeps them, each a name, a point and a
-- radius; a check-in within any one's radius is at the office. The one office point Payroll Setup → Your Rules had, if it
-- was set, becomes the first location, "Office", with its radius. Its columns on payroll_settings stay, unused, rather
-- than being dropped in the same deploy. A punch keeps the name of the location it was within (never the coordinates).

CREATE TABLE "check_in_locations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "radius_metres" INTEGER NOT NULL DEFAULT 150,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "check_in_locations_pkey" PRIMARY KEY ("id")
);

INSERT INTO "check_in_locations" ("id", "name", "latitude", "longitude", "radius_metres", "created_at", "updated_at")
SELECT gen_random_uuid(), 'Office', "office_latitude", "office_longitude", "office_radius_metres", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "payroll_settings"
WHERE "id" = 1 AND "office_latitude" IS NOT NULL AND "office_longitude" IS NOT NULL;

ALTER TABLE "attendance_punches" ADD COLUMN "location_name" TEXT;
