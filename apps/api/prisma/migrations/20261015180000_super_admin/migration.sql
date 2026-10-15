-- Super Admin (owner's decision, 15 October 2026): "Only the super admin role has the ability to delete any record; no
-- other user can delete any record." A new role above Admin: it can do everything an Admin can, and it alone deletes.
-- Only a Super Admin gives or takes away the role, and there is always at least one active Super Admin (checked by the
-- API). The seed adds the same role to a new database, and gives it to the first admin account it creates.

-- 1. The role (packages/shared ROLES and ROLE_LABELS).
INSERT INTO "roles" ("id", "key", "name") VALUES (gen_random_uuid(), 'super_admin', 'Super Admin')
ON CONFLICT ("key") DO NOTHING;

-- 2. The first Super Admin: the original admin account, admin@trendlix.com if there is one, otherwise the user who has
-- had the admin role the longest (the earliest created). Nobody else: further Super Admins are given the role by this
-- one, in the app.
WITH original AS (
  SELECT u."id" FROM "users" u
  WHERE u."email" = 'admin@trendlix.com'
     OR (
       NOT EXISTS (SELECT 1 FROM "users" WHERE "email" = 'admin@trendlix.com')
       AND EXISTS (
         SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
         WHERE ur."user_id" = u."id" AND r."key" = 'admin'
       )
     )
  ORDER BY u."created_at", u."id"
  LIMIT 1
)
INSERT INTO "user_roles" ("user_id", "role_id")
SELECT original."id", r."id" FROM original, "roles" r WHERE r."key" = 'super_admin'
ON CONFLICT DO NOTHING;
