-- The order an Admin sets for departments, and for the teams of each department.
ALTER TABLE "departments" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Existing departments and teams start in alphabetical order.
UPDATE "departments" d SET "sort_order" = s.position
FROM (SELECT "id", row_number() OVER (PARTITION BY "parent_id" ORDER BY "name_en") AS position FROM "departments") s
WHERE d."id" = s."id";
