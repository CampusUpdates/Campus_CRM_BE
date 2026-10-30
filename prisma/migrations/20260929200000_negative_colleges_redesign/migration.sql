/*
  Warnings:

  - You are about to drop the column `collegeId` on the `LeadNegativeCollege` table. All the data in the column will be lost.
  - Added the required column `collegeName` to the `LeadNegativeCollege` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "LeadNegativeCollege" DROP CONSTRAINT "LeadNegativeCollege_collegeId_fkey";

-- DropIndex
DROP INDEX "LeadNegativeCollege_collegeId_idx";

-- DropIndex
ALTER TABLE "LeadNegativeCollege" DROP CONSTRAINT "LeadNegativeCollege_leadId_collegeId_key";

-- AlterTable
ALTER TABLE "LeadNegativeCollege" ADD COLUMN     "collegeName" TEXT;

-- DataMigration (Manually Added)
UPDATE "LeadNegativeCollege" lnc
SET "collegeName" = c.name
FROM "College" c
WHERE lnc."collegeId" = c.id;

-- Make collegeName required after copying
ALTER TABLE "LeadNegativeCollege" ALTER COLUMN "collegeName" SET NOT NULL;

-- AlterTable
ALTER TABLE "LeadNegativeCollege" DROP COLUMN "collegeId";
