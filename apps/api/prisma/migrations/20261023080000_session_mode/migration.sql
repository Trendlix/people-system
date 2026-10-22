-- A developer who is also an employee chooses how to use the system (owner, 22 October 2026: "when a developer signin,
-- give hin a switched to use the account as the main role assigned to him or as a developer, to not confuse him";
-- packages/shared session-modes.ts): kept on the session, 'self' (as themselves) or 'developer' (read only,
-- pseudonyms); null until they choose on the website, and for everyone else. Sessions open now keep null: a developer
-- with another role is asked on their next page.
ALTER TABLE "sessions" ADD COLUMN "mode" TEXT;
