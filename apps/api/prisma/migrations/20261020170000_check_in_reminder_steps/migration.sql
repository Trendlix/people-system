-- "You haven't checked in" every 10 minutes (owner, 20 October 2026: "a reminder for people that didn't checkin and not
-- on a leave every 10 minutes. like a popup"; asked, from the "Shift start", stopping "After 2 hours", "No, always on";
-- apps/mobile/README.md, Phase 4). The reminders sent were one row a user, working day and kind, sent once; the same row
-- now counts the steps, so each 10-minute step goes once whichever of the API's processes sends it (the row is claimed
-- only while its last_sent_at is before the step's start):
-- - `count`: how many went that day (the rows of before: 1);
-- - `last_sent_at`: when the last went (the rows of before: their sent_at);
-- - `notification_id`: the day's one inbox row, refreshed at each step instead of a new row each time (its row deleted:
--   none, and the next step makes a new one).
-- "Still checked in?" stays once a day. The switch of "You haven't checked in" (notification_settings.check_in_reminder)
-- is kept but no longer read: it is always on.

ALTER TABLE "reminders_sent" RENAME COLUMN "sent_at" TO "last_sent_at";

ALTER TABLE "reminders_sent"
  ADD COLUMN "count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "notification_id" UUID,
  ADD CONSTRAINT "reminders_sent_count_check" CHECK ("count" >= 1);

ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
