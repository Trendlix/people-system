-- The Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers";
-- "act as super admin with numbers hidden and real sensitve numbers as national ids hidden changing nothing, and no
-- act as"; hidden: "Money and personal IDs"). A developer sees what a Super Admin sees, read only, every amount and
-- personal ID masked by the API (packages/shared developer.ts). Only a Super Admin gives it, and only with Employee
-- beside it (checked by the API). The seed adds it to a new database.
INSERT INTO "roles" ("id", "key", "name") VALUES (gen_random_uuid(), 'developer', 'Developer')
ON CONFLICT ("key") DO NOTHING;
