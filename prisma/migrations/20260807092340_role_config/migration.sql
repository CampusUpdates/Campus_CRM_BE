/*
  Warnings:

  - A unique constraint covering the columns `[displayOrder]` on the table `Role` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Role" ALTER COLUMN "displayOrder" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Role_displayOrder_key" ON "Role"("displayOrder");
