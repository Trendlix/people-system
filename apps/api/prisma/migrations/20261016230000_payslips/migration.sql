-- Payslips (owner's decisions, 16 October 2026): drawn by the system from an approved payroll line, straight to a
-- protected PDF, and kept. The English one is issued for every line not on hold when HR marks the run paid; the Arabic
-- one is drawn the first time it is asked for. One of each language a line, never drawn again once kept: the run is
-- locked from the CEO's approval on. Salary data, restricted to HR, Finance and the CEO like the line.
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payslips_language_check" CHECK ("language" IN ('en', 'ar'))
);
CREATE UNIQUE INDEX "payslips_line_id_language_key" ON "payslips"("line_id", "language");
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "payroll_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
