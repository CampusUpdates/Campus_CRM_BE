-- AlterTable
ALTER TABLE "CollegeCounsellingRequest" ADD COLUMN IF NOT EXISTS "preferredDate" DATE;
ALTER TABLE "CollegeCounsellingRequest" ADD COLUMN IF NOT EXISTS "preferredTime" TEXT;
