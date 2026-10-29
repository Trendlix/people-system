-- The links behind a CV's words (owner, 29 October 2026: "the OCR is not filling the linkedin link like in the candidate
-- profile": a "LinkedIn" word or icon linking to the profile, its address not in the CV's text). Every CV read from its
-- own text (a PDF's, a Word file's) is read again by the recruitment round, 25 a minute, so the links behind its words
-- are kept with it (cv-text.ts) and its LinkedIn link found; should that fail, its earlier reading stays. Scans read by
-- the OCR service aren't: HR's Read again does one when needed. A bulk upload's waiting rows are left as they are.
UPDATE "cv_readings"
SET "status" = 'pending', "attempts" = 0, "next_try_at" = now(), "error" = NULL, "force_ocr" = false
WHERE "status" = 'read' AND "method" IN ('pdf', 'docx') AND "upload_id" IS NULL;
