-- Google Maps for every map in the system (owner, 24 October 2026, on Check-in Setup's map: "is there another map
-- provider?", then "Google Maps"): Organization → Check-in Setup → Google Maps, a Super Admin's only, one row (id 1),
-- made on the first save. With a browser key every map is Google's; without one, OpenStreetMap's, as before. The key
-- is a browser key, restricted by Google to the website and two APIs; the Map ID is optional (Advanced Markers).
CREATE TABLE "maps_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "browser_key" TEXT,
    "map_id" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maps_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "maps_settings_id_check" CHECK ("id" = 1)
);

ALTER TABLE "maps_settings" ADD CONSTRAINT "maps_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
