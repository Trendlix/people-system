-- Fixes learned from HR's corrections to ID card readings.
-- CreateTable
CREATE TABLE "ocr_corrections" (
    "id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "wrong" TEXT NOT NULL,
    "right" TEXT NOT NULL,
    "times_seen" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ocr_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ocr_corrections_field_wrong_key" ON "ocr_corrections"("field", "wrong");

-- AddForeignKey
ALTER TABLE "ocr_corrections" ADD CONSTRAINT "ocr_corrections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

