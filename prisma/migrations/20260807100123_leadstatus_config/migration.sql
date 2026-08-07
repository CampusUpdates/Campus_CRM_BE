/*
  Warnings:

  - A unique constraint covering the columns `[displayOrder]` on the table `LeadStatus` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "LeadStatus" ALTER COLUMN "displayOrder" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "LeadStatus_displayOrder_key" ON "LeadStatus"("displayOrder");
