-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "sourceOther" TEXT;

-- Safely map existing old values to OTHER and populate sourceOther
UPDATE "Lead" 
SET "sourceOther" = "source"::text, 
    "source" = 'OTHER'::"LeadSource" 
WHERE "source"::text NOT IN ('CAT', 'NMAT', 'MHCET', 'MAT', 'IBSAT', 'SNAP', 'OTHER');

-- AlterEnum
BEGIN;
CREATE TYPE "LeadSource_new" AS ENUM ('CAT', 'NMAT', 'MHCET', 'MAT', 'IBSAT', 'SNAP', 'OTHER');
ALTER TABLE "Lead" ALTER COLUMN "source" TYPE "LeadSource_new" USING ("source"::text::"LeadSource_new");
ALTER TYPE "LeadSource" RENAME TO "LeadSource_old";
ALTER TYPE "LeadSource_new" RENAME TO "LeadSource";
DROP TYPE "LeadSource_old";
COMMIT;
