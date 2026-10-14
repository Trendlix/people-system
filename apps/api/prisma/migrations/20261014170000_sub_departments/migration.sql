-- DropIndex
DROP INDEX "departments_name_en_key";

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "parent_id" UUID;

-- AlterTable
ALTER TABLE "shifts" ALTER COLUMN "working_days" SET DEFAULT ARRAY[0, 1, 2, 3, 4]::SMALLINT[];

-- CreateIndex
CREATE UNIQUE INDEX "departments_parent_id_name_en_key" ON "departments"("parent_id", "name_en");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

