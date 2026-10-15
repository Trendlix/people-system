-- PDF templates (owner's decision, 15 October 2026): an official form (social insurance Forms 1 and 6 …) is uploaded as
-- the PDF it is issued as, never converted, and HR places each field on it once; every document is the original PDF
-- with the values printed where the fields were placed. Word templates stay for the company's own documents. A version
-- says which it is (format); a PDF's pages as shown (pdf_pages, read when it is uploaded) and its fields (pdf_fields,
-- [] until HR places them) are kept with it; a Word version has neither.
ALTER TABLE "template_versions" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'docx',
ADD COLUMN "pdf_pages" JSONB,
ADD COLUMN "pdf_fields" JSONB,
ADD CONSTRAINT "template_versions_format_check" CHECK ("format" IN ('docx', 'pdf'));
