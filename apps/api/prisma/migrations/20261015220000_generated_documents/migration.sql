-- Documents generated from the templates: the profile's Contracts tab (spec §8.3–8.4; owner's request, 15 October
-- 2026). HR fills a published template in for an employee (the contract and its social insurance copy, the job offer,
-- the NDA, the social insurance forms, letters, certificates, the resignation request and the clearance); the filled
-- .docx is kept, then printed, signed, scanned back in and verified.

-- One generated document. It belongs to the employee, the employment it was issued under, and for some slots a
-- contract version (each copy of the contract) or an ending (the resignation request, the clearance, Form 6): deleting
-- any of those takes its documents with it (only a draft contract can be deleted, and only by a Super Admin). The
-- template version it was filled in from is kept as long as the document is (a published version is never deleted).
-- The filled file and the signed scan are kept in the database, like paperwork, so the daily backup includes them.
-- `inputs` holds what was typed when generating (letter_to, letter_purpose); `has_restricted` says it prints
-- restricted data (national ID, salary, bank details), so every view of it is written to the audit log.
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employment_id" UUID,
    "contract_id" UUID,
    "ending_id" UUID,
    "slot_key" TEXT NOT NULL,
    "template_version_id" UUID NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "document_date" DATE NOT NULL,
    "file_name" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "has_restricted" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printed_by" UUID,
    "printed_at" TIMESTAMPTZ,
    "signed_uploaded_by" UUID,
    "signed_uploaded_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "signed_file_name" TEXT,
    "signed_mime" TEXT,
    "signed_size" INTEGER,
    "signed_data" BYTEA,
    "note" TEXT,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "generated_documents_status_check" CHECK ("status" IN ('generated', 'printed', 'signed', 'verified')),
    CONSTRAINT "generated_documents_size_bytes_check" CHECK ("size_bytes" >= 0),
    -- a signed or verified document has its scan
    CONSTRAINT "generated_documents_signed_scan_check" CHECK ("status" NOT IN ('signed', 'verified') OR "signed_data" IS NOT NULL)
);
-- an employee's documents of a slot (the Contracts tab)
CREATE INDEX "generated_documents_employee_id_slot_key_idx" ON "generated_documents"("employee_id", "slot_key");

ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_ending_id_fkey" FOREIGN KEY ("ending_id") REFERENCES "employment_endings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- who did each step is kept as long as the account is; a deleted account leaves it empty
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_printed_by_fkey" FOREIGN KEY ("printed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_signed_uploaded_by_fkey" FOREIGN KEY ("signed_uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
