-- AlterEnum: Add SCHEDULED to CounsellingStatus
ALTER TYPE "CounsellingStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

-- AlterTable: Add scheduled fields to CollegeCounsellingRequest
ALTER TABLE "CollegeCounsellingRequest" ADD COLUMN IF NOT EXISTS "scheduledDate" DATE;
ALTER TABLE "CollegeCounsellingRequest" ADD COLUMN IF NOT EXISTS "scheduledTime" TEXT;
ALTER TABLE "CollegeCounsellingRequest" ADD COLUMN IF NOT EXISTS "counsellingNotes" TEXT;
ALTER TABLE "CollegeCounsellingRequest" ADD COLUMN IF NOT EXISTS "scheduledById" UUID;
ALTER TABLE "CollegeCounsellingRequest" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);

-- Create Index on scheduledById
CREATE INDEX IF NOT EXISTS "CollegeCounsellingRequest_scheduledById_idx" ON "CollegeCounsellingRequest"("scheduledById");

-- Add ForeignKey
DO $$ BEGIN
    ALTER TABLE "CollegeCounsellingRequest" ADD CONSTRAINT "CollegeCounsellingRequest_scheduledById_fkey"
    FOREIGN KEY ("scheduledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Update Partial Unique Index to ensure at most one active (REQUESTED or SCHEDULED) counselling request per lead + college
DROP INDEX IF EXISTS "unique_active_lead_college_counselling";
CREATE UNIQUE INDEX "unique_active_lead_college_counselling"
ON "CollegeCounsellingRequest"("leadId", "collegeId")
WHERE "status" IN ('REQUESTED', 'SCHEDULED');
