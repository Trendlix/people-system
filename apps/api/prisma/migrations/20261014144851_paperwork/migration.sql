-- AlterTable
ALTER TABLE "shifts" ALTER COLUMN "working_days" SET DEFAULT ARRAY[0, 1, 2, 3, 4]::SMALLINT[];

-- CreateTable
CREATE TABLE "paperwork_items" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "ocr_status" TEXT NOT NULL DEFAULT 'pending',
    "ocr_text" TEXT,
    "ocr_at" TIMESTAMPTZ,
    "uploaded_by_id" UUID,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paperwork_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paperwork_items_employee_id_kind_idx" ON "paperwork_items"("employee_id", "kind");

-- AddForeignKey
ALTER TABLE "paperwork_items" ADD CONSTRAINT "paperwork_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paperwork_items" ADD CONSTRAINT "paperwork_items_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
