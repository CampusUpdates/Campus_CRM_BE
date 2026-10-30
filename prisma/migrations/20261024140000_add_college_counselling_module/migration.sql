-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "CounsellingStatus" AS ENUM ('REQUESTED', 'COMPLETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "CollegeCounsellingRequest" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "collegeId" UUID NOT NULL,
    "leadCollegeId" UUID,
    "preferredTiming" TEXT,
    "purpose" TEXT,
    "status" "CounsellingStatus" NOT NULL DEFAULT 'REQUESTED',
    "completionRemark" TEXT,
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollegeCounsellingRequest_pkey" PRIMARY KEY ("id")
);

-- Standard Indexes
CREATE INDEX IF NOT EXISTS "CollegeCounsellingRequest_leadId_idx" ON "CollegeCounsellingRequest"("leadId");
CREATE INDEX IF NOT EXISTS "CollegeCounsellingRequest_collegeId_idx" ON "CollegeCounsellingRequest"("collegeId");
CREATE INDEX IF NOT EXISTS "CollegeCounsellingRequest_status_idx" ON "CollegeCounsellingRequest"("status");
CREATE INDEX IF NOT EXISTS "CollegeCounsellingRequest_requestedById_idx" ON "CollegeCounsellingRequest"("requestedById");
CREATE INDEX IF NOT EXISTS "CollegeCounsellingRequest_completedById_idx" ON "CollegeCounsellingRequest"("completedById");

-- Concurrency-safe Partial Unique Index (Only one active REQUESTED per lead + college)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_lead_college_counselling"
ON "CollegeCounsellingRequest"("leadId", "collegeId")
WHERE "status" = 'REQUESTED';

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "CollegeCounsellingRequest" ADD CONSTRAINT "CollegeCounsellingRequest_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "CollegeCounsellingRequest" ADD CONSTRAINT "CollegeCounsellingRequest_collegeId_fkey"
    FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "CollegeCounsellingRequest" ADD CONSTRAINT "CollegeCounsellingRequest_leadCollegeId_fkey"
    FOREIGN KEY ("leadCollegeId") REFERENCES "LeadCollege"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "CollegeCounsellingRequest" ADD CONSTRAINT "CollegeCounsellingRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "CollegeCounsellingRequest" ADD CONSTRAINT "CollegeCounsellingRequest_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
