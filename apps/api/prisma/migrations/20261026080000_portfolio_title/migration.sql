-- A section title for each position's portfolio on the careers forms (owner, 26 October 2026, on the careers site's
-- form: "this part needs to be more clearer .. i cant visualize that this is a portfolio section"; asked, "a section
-- title per position"; packages/shared portfolio.ts): the portfolio part's heading ("Your showreel", "Your case
-- studies"), at most 40 characters, HR's to change in Recruitment Settings' "Portfolio on the Forms", beside the hint.
--
-- NULL: the rule's title for the job title (portfolioDefaultFor). Nothing is moved: every row kept so far takes it.
-- Written to apply again harmlessly on a database that has the column already (the shared test database).

ALTER TABLE "portfolio_settings" ADD COLUMN IF NOT EXISTS "title" TEXT;

ALTER TABLE "portfolio_settings" DROP CONSTRAINT IF EXISTS "portfolio_settings_title_check";
ALTER TABLE "portfolio_settings" ADD CONSTRAINT "portfolio_settings_title_check" CHECK ("title" IS NULL OR char_length("title") BETWEEN 1 AND 40);
