-- An agreed last working day on an employment ending (owner, 26 October 2026: "let me add agreed on last working date
-- only by admin and HR"). last_working_day stays the day the ending runs to: the agreed one when last_day_agreed, else
-- the one worked out from the notice, which notice_ends_on keeps beside it. Existing endings were all worked out, so
-- notice_ends_on starts as their last_working_day.
ALTER TABLE "employment_endings" ADD COLUMN "notice_ends_on" DATE;
ALTER TABLE "employment_endings" ADD COLUMN "last_day_agreed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "employment_endings" SET "notice_ends_on" = "last_working_day";
ALTER TABLE "employment_endings" ALTER COLUMN "notice_ends_on" SET NOT NULL;
