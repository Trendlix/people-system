-- Read a CV again (owner, 29 October 2026: "what can we do if the OCR missed pulling data? can i perform a rerun for
-- example?"): HR asks for a CV to be read again, as before (its own text, a scan by the OCR service), or as a scan
-- whatever its own text (a designed PDF whose text comes out jumbled). Cleared once read.
ALTER TABLE "cv_readings" ADD COLUMN "force_ocr" BOOLEAN NOT NULL DEFAULT false;
