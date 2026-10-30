-- DropForeignKey
ALTER TABLE "DataUpload" DROP CONSTRAINT IF EXISTS "DataUpload_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "StudentData" DROP CONSTRAINT IF EXISTS "StudentData_categoryId_fkey";

-- AddForeignKey
ALTER TABLE "DataUpload" ADD CONSTRAINT "DataUpload_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DataCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentData" ADD CONSTRAINT "StudentData_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DataCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
