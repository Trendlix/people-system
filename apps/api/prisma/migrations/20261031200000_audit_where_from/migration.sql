-- Where each audit entry came from (owner, 31 October 2026: "i want a log for all actions taken on the system ,, same as
-- the one on trendlix website"; "with location and ip capture"; the app's position "with each sign-in and action"): the
-- address and whether the website signed it, Vercel's city, region and country, the user agent, and the phone's
-- position from the app. All null for entries no request wrote, and for those from before.
ALTER TABLE "audit_log"
    ADD COLUMN "ip" TEXT,
    ADD COLUMN "ip_source" TEXT,
    ADD COLUMN "country" TEXT,
    ADD COLUMN "region" TEXT,
    ADD COLUMN "city" TEXT,
    ADD COLUMN "user_agent" TEXT,
    ADD COLUMN "latitude" DECIMAL(9,6),
    ADD COLUMN "longitude" DECIMAL(9,6),
    ADD COLUMN "accuracy_metres" INTEGER,
    ADD COLUMN "location_mock" BOOLEAN;

-- the Sign-ins tab and the Result filter: by action, newest first
CREATE INDEX "audit_log_action_id_idx" ON "audit_log"("action", "id");
