-- The company representative's name and job title in English too (owner, 15 October 2026), for the English side of
-- bilingual documents ({{company_rep_name_en}}, {{company_rep_title_en}}); rep_name and rep_title stay the Arabic ones.
ALTER TABLE "company" ADD COLUMN "rep_name_en" TEXT, ADD COLUMN "rep_title_en" TEXT;
