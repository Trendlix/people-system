-- A serial on every generated document (owner, 2 November 2026: "print like a serial number on each document generated
-- (Contract - NDA - etc..) and when uploaded verify the document from the OCR and the Serial Printed"): the running
-- number they are made from, the serial itself (none on those generated before), and what the signed copy's scan showed.
CREATE SEQUENCE "generated_document_serial_seq" START 1;

ALTER TABLE "generated_documents" ADD COLUMN "serial" TEXT;
ALTER TABLE "generated_documents" ADD COLUMN "serial_check" TEXT;
ALTER TABLE "generated_documents" ADD COLUMN "serials_found" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "generated_documents" ADD COLUMN "serial_checked_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX "generated_documents_serial_key" ON "generated_documents"("serial");
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_serial_check_check" CHECK ("serial_check" IS NULL OR "serial_check" IN ('match', 'mismatch', 'not_found', 'unchecked'));
