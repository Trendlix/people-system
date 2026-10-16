-- View as another user (owner's decision, 17 October 2026: "a super admin can view any other user profile from a
-- switcher, only the super admin"; "view only with a button to act but by default not checked"). A Super Admin sees
-- the system as the user they switch to, view only; with Act as them on, what they do is done in that user's name.
-- Each audit entry made then keeps both: the user it was done as (user_id, as before) and the Super Admin who did it
-- (on_behalf_by). The restricted data they view while switched is recorded the same way. Null for everything else,
-- and for everything recorded until now.
ALTER TABLE "audit_log" ADD COLUMN "on_behalf_by" UUID,
  -- never the user it was done as: the Super Admin's own entries (switching, Act as them, going back) leave it null
  ADD CONSTRAINT "audit_log_on_behalf_by_check" CHECK ("on_behalf_by" IS NULL OR "on_behalf_by" IS DISTINCT FROM "user_id");

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_on_behalf_by_fkey" FOREIGN KEY ("on_behalf_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
