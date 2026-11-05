-- Bank transfer batches (owner, 5 November 2026: "allow me to select a group of people for the transfer", "and to
-- confirm each batch sent to be recorded"): the people ticked for one bank file of an approved run, each with the
-- amount transferred, made when the file is downloaded and confirmed once sent to the bank.
CREATE TABLE "payroll_bank_batches" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "file" TEXT NOT NULL,
    "value_date" DATE,
    "total" DECIMAL(14,2) NOT NULL,
    "made_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "sent_by" UUID,

    CONSTRAINT "payroll_bank_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_bank_batches_file_check" CHECK ("file" IN ('cib', 'ach')),
    CONSTRAINT "payroll_bank_batches_number_check" CHECK ("number" > 0),
    CONSTRAINT "payroll_bank_batches_total_check" CHECK ("total" > 0)
);

CREATE TABLE "payroll_bank_batch_lines" (
    "batch_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payroll_bank_batch_lines_pkey" PRIMARY KEY ("batch_id", "line_id"),
    CONSTRAINT "payroll_bank_batch_lines_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "payroll_bank_batches_run_id_number_key" ON "payroll_bank_batches"("run_id", "number");
CREATE INDEX "payroll_bank_batch_lines_line_id_idx" ON "payroll_bank_batch_lines"("line_id");

ALTER TABLE "payroll_bank_batches" ADD CONSTRAINT "payroll_bank_batches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_bank_batches" ADD CONSTRAINT "payroll_bank_batches_made_by_fkey" FOREIGN KEY ("made_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_bank_batches" ADD CONSTRAINT "payroll_bank_batches_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_bank_batch_lines" ADD CONSTRAINT "payroll_bank_batch_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payroll_bank_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_bank_batch_lines" ADD CONSTRAINT "payroll_bank_batch_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "payroll_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
