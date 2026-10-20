-- Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
-- home"; asked, the owner chose "Label Home, flag elsewhere", and HR "then approved by the HR and CEO"). The rules:
-- packages/shared home-locations.ts.
--
-- 1. A home location asked for: by the employee, its point (6 decimals), the radius (100 m to start with; HR may change
--    it within 20 to 5,000), a label or address if given (up to 200 characters), the reading's accuracy when it came from
--    the device; decided by HR, then the CEO. The point and the label are personal data, kept only while the request is
--    being decided or in force (approved): rejected, withdrawn, replaced or removed, they are deleted (null). One
--    approved a person and one being decided at a time, kept by the API under the employee's row lock.
-- 2. Each step of a request, as an attendance correction's: never the point.
-- 3. A check-in within the person's approved home is 'home' (on the punch and the day it makes), and a remote one by
--    someone with an approved home is flagged 'not_home_or_office': the places and the flags allowed grow by one each.

-- 1.
CREATE TABLE "home_location_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "radius_metres" INTEGER NOT NULL DEFAULT 100,
    "label" TEXT,
    "accuracy_metres" INTEGER,
    "status" TEXT NOT NULL,
    "rejected_stage" TEXT,
    "reject_reason" TEXT,
    "approved_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "home_location_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "home_location_requests_status_check" CHECK ("status" IN ('with_hr', 'with_ceo', 'approved', 'rejected', 'withdrawn', 'replaced', 'removed')),
    CONSTRAINT "home_location_requests_radius_check" CHECK ("radius_metres" BETWEEN 20 AND 5000),
    CONSTRAINT "home_location_requests_point_check" CHECK (
        ("latitude" IS NULL) = ("longitude" IS NULL)
        AND ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
        AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
    ),
    -- the point while it is being decided or in force, and never after
    CONSTRAINT "home_location_requests_point_kept_check" CHECK (("latitude" IS NOT NULL) = ("status" IN ('with_hr', 'with_ceo', 'approved'))),
    CONSTRAINT "home_location_requests_label_check" CHECK (
        "label" IS NULL OR (length(btrim("label")) BETWEEN 1 AND 200 AND "status" IN ('with_hr', 'with_ceo', 'approved'))
    ),
    CONSTRAINT "home_location_requests_accuracy_check" CHECK ("accuracy_metres" IS NULL OR "accuracy_metres" >= 0),
    CONSTRAINT "home_location_requests_rejected_check" CHECK (
        ("status" = 'rejected') = ("rejected_stage" IS NOT NULL)
        AND ("rejected_stage" IS NULL OR "rejected_stage" IN ('hr', 'ceo'))
    ),
    CONSTRAINT "home_location_requests_approved_check" CHECK ("status" <> 'approved' OR "approved_at" IS NOT NULL),
    CONSTRAINT "home_location_requests_ended_check" CHECK (("ended_at" IS NOT NULL) = ("status" IN ('rejected', 'withdrawn', 'replaced', 'removed')))
);

-- 2.
CREATE TABLE "home_location_steps" (
    "id" BIGSERIAL NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT,
    "radius_metres" INTEGER,
    "comment" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_location_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "home_location_steps_kind_check" CHECK ("kind" IN ('submitted', 'hr_decision', 'ceo_decision', 'withdrawn', 'replaced', 'removed')),
    CONSTRAINT "home_location_steps_decision_check" CHECK (
        ("decision" IS NOT NULL) = ("kind" IN ('hr_decision', 'ceo_decision'))
        AND ("decision" IS NULL OR "decision" IN ('approve', 'reject'))
    ),
    CONSTRAINT "home_location_steps_radius_check" CHECK ("radius_metres" IS NULL OR "radius_metres" BETWEEN 20 AND 5000)
);

CREATE INDEX "home_location_requests_employee_id_status_idx" ON "home_location_requests"("employee_id", "status");
CREATE INDEX "home_location_requests_status_idx" ON "home_location_requests"("status");
CREATE INDEX "home_location_steps_request_id_idx" ON "home_location_steps"("request_id");

ALTER TABLE "home_location_requests" ADD CONSTRAINT "home_location_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_location_requests" ADD CONSTRAINT "home_location_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "home_location_steps" ADD CONSTRAINT "home_location_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "home_location_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_location_steps" ADD CONSTRAINT "home_location_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3.
ALTER TABLE "attendance_days" DROP CONSTRAINT "attendance_days_place_check";
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_place_check" CHECK ("place" IS NULL OR "place" IN ('office', 'home', 'remote', 'unknown'));
ALTER TABLE "attendance_days" DROP CONSTRAINT "attendance_days_flags_check";
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_flags_check" CHECK ("flags" <@ ARRAY['outside_office', 'location_unknown', 'fake_gps', 'not_home_or_office']::TEXT[]);

ALTER TABLE "attendance_punches" DROP CONSTRAINT "attendance_punches_place_check";
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_place_check" CHECK ("place" IN ('office', 'home', 'remote', 'unknown'));
ALTER TABLE "attendance_punches" DROP CONSTRAINT "attendance_punches_flags_check";
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_flags_check" CHECK ("flags" <@ ARRAY['outside_office', 'location_unknown', 'fake_gps', 'not_home_or_office']::TEXT[]);
