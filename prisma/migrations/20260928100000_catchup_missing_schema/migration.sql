-- ============================================================
-- CATCH-UP MIGRATION: Sync schema.prisma to database
-- ============================================================

-- 1. Add missing enum values
ALTER TYPE "TPCUserStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "TPCUserStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "TPCUserStatus" ADD VALUE IF NOT EXISTS 'NO_REPLY';
ALTER TYPE "TPCUserStatus" ADD VALUE IF NOT EXISTS 'NOT_INTERESTED';

ALTER TYPE "CallOutcome" ADD VALUE IF NOT EXISTS 'DISCONNECTED';

ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'CASUAL_LEAVE';

ALTER TYPE "DataAssignmentStatus" ADD VALUE IF NOT EXISTS 'RECLAIMED';

-- 2. Add Team.managerId column
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "managerId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "Team" ALTER COLUMN "managerId" DROP DEFAULT;
CREATE INDEX IF NOT EXISTS "Team_managerId_idx" ON "Team"("managerId");
ALTER TABLE "Team" ADD CONSTRAINT "Team_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Create new enum types for LeadCollegeInterview
DO $$ BEGIN
  CREATE TYPE "LeadInterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LeadInterviewResult" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'ON_HOLD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LeadPaymentType" AS ENUM ('APPLICATION_FEE', 'ADMISSION_FEE', 'TUITION_FEE', 'REFUND', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LeadRefundStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PROCESSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Create LeadCollegeInterview table
CREATE TABLE IF NOT EXISTS "LeadCollegeInterview" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "leadCollegeId"     UUID NOT NULL,
  "scheduledAt"       TIMESTAMP(3) NOT NULL,
  "conductedAt"       TIMESTAMP(3),
  "status"            "LeadInterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
  "result"            "LeadInterviewResult" NOT NULL DEFAULT 'PENDING',
  "feedback"          TEXT,
  "meetingLink"       TEXT,
  "rescheduledFromId" UUID,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadCollegeInterview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeadCollegeInterview_leadCollegeId_fkey" FOREIGN KEY ("leadCollegeId") REFERENCES "LeadCollege"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadCollegeInterview_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "LeadCollegeInterview"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LeadCollegeInterview_leadCollegeId_idx" ON "LeadCollegeInterview"("leadCollegeId");
CREATE INDEX IF NOT EXISTS "LeadCollegeInterview_scheduledAt_idx" ON "LeadCollegeInterview"("scheduledAt");
CREATE INDEX IF NOT EXISTS "LeadCollegeInterview_status_idx" ON "LeadCollegeInterview"("status");
CREATE INDEX IF NOT EXISTS "LeadCollegeInterview_rescheduledFromId_idx" ON "LeadCollegeInterview"("rescheduledFromId");

-- 5. Create SelectionLetter table
CREATE TABLE IF NOT EXISTS "SelectionLetter" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "leadCollegeId"     UUID NOT NULL,
  "letterUrl"         TEXT,
  "issuedAt"          TIMESTAMP(3) NOT NULL,
  "admissionLastDate" TIMESTAMP(3) NOT NULL,
  "issuedById"        UUID,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SelectionLetter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SelectionLetter_leadCollegeId_fkey" FOREIGN KEY ("leadCollegeId") REFERENCES "LeadCollege"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SelectionLetter_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SelectionLetter_leadCollegeId_idx" ON "SelectionLetter"("leadCollegeId");
CREATE INDEX IF NOT EXISTS "SelectionLetter_issuedAt_idx" ON "SelectionLetter"("issuedAt");
CREATE INDEX IF NOT EXISTS "SelectionLetter_admissionLastDate_idx" ON "SelectionLetter"("admissionLastDate");
CREATE INDEX IF NOT EXISTS "SelectionLetter_issuedById_idx" ON "SelectionLetter"("issuedById");

-- 6. Create LeadCollegePayment table
CREATE TABLE IF NOT EXISTS "LeadCollegePayment" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "leadCollegeId"   UUID NOT NULL,
  "type"            "LeadPaymentType" NOT NULL,
  "amount"          DECIMAL(10, 2) NOT NULL,
  "transactionRef"  TEXT,
  "paymentMode"     TEXT,
  "paidAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remarks"         TEXT,
  "processedById"   UUID,
  "parentPaymentId" UUID,
  "refundStatus"    "LeadRefundStatus",
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadCollegePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeadCollegePayment_leadCollegeId_fkey" FOREIGN KEY ("leadCollegeId") REFERENCES "LeadCollege"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadCollegePayment_parentPaymentId_fkey" FOREIGN KEY ("parentPaymentId") REFERENCES "LeadCollegePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadCollegePayment_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LeadCollegePayment_leadCollegeId_idx" ON "LeadCollegePayment"("leadCollegeId");
CREATE INDEX IF NOT EXISTS "LeadCollegePayment_paidAt_idx" ON "LeadCollegePayment"("paidAt");
CREATE INDEX IF NOT EXISTS "LeadCollegePayment_type_idx" ON "LeadCollegePayment"("type");
CREATE INDEX IF NOT EXISTS "LeadCollegePayment_parentPaymentId_idx" ON "LeadCollegePayment"("parentPaymentId");
CREATE INDEX IF NOT EXISTS "LeadCollegePayment_refundStatus_idx" ON "LeadCollegePayment"("refundStatus");
CREATE INDEX IF NOT EXISTS "LeadCollegePayment_processedById_idx" ON "LeadCollegePayment"("processedById");

-- 7. Create LeadCollegeHistory table
CREATE TABLE IF NOT EXISTS "LeadCollegeHistory" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "leadCollegeId" UUID NOT NULL,
  "fromStatusId"  INTEGER,
  "toStatusId"    INTEGER NOT NULL,
  "changedById"   UUID,
  "remarks"       TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadCollegeHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeadCollegeHistory_leadCollegeId_fkey" FOREIGN KEY ("leadCollegeId") REFERENCES "LeadCollege"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadCollegeHistory_fromStatusId_fkey" FOREIGN KEY ("fromStatusId") REFERENCES "LeadStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadCollegeHistory_toStatusId_fkey" FOREIGN KEY ("toStatusId") REFERENCES "LeadStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LeadCollegeHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LeadCollegeHistory_leadCollegeId_idx" ON "LeadCollegeHistory"("leadCollegeId");
CREATE INDEX IF NOT EXISTS "LeadCollegeHistory_createdAt_idx" ON "LeadCollegeHistory"("createdAt");
CREATE INDEX IF NOT EXISTS "LeadCollegeHistory_fromStatusId_idx" ON "LeadCollegeHistory"("fromStatusId");
CREATE INDEX IF NOT EXISTS "LeadCollegeHistory_toStatusId_idx" ON "LeadCollegeHistory"("toStatusId");
CREATE INDEX IF NOT EXISTS "LeadCollegeHistory_changedById_idx" ON "LeadCollegeHistory"("changedById");

-- 8. Create LeadNegativeCollege table
CREATE TABLE IF NOT EXISTS "LeadNegativeCollege" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "leadId"    UUID NOT NULL,
  "collegeId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadNegativeCollege_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeadNegativeCollege_leadId_collegeId_key" UNIQUE ("leadId", "collegeId"),
  CONSTRAINT "LeadNegativeCollege_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadNegativeCollege_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LeadNegativeCollege_leadId_idx" ON "LeadNegativeCollege"("leadId");
CREATE INDEX IF NOT EXISTS "LeadNegativeCollege_collegeId_idx" ON "LeadNegativeCollege"("collegeId");

-- 9. Create Holiday table
CREATE TABLE IF NOT EXISTS "Holiday" (
  "id"          SERIAL NOT NULL,
  "date"        DATE NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Holiday_date_key" UNIQUE ("date")
);
CREATE INDEX IF NOT EXISTS "Holiday_date_idx" ON "Holiday"("date");

-- 10. Create Todo table
CREATE TABLE IF NOT EXISTS "Todo" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"      UUID NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "dueDate"     DATE NOT NULL,
  "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  "priority"    TEXT NOT NULL DEFAULT 'MEDIUM',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Todo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Todo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Todo_userId_idx" ON "Todo"("userId");
CREATE INDEX IF NOT EXISTS "Todo_dueDate_idx" ON "Todo"("dueDate");

-- 11. Create AttendancePolicy table
CREATE TABLE IF NOT EXISTS "AttendancePolicy" (
  "id"                SERIAL NOT NULL,
  "officeId"          INTEGER NOT NULL,
  "officeStartTime"   TEXT NOT NULL,
  "officeEndTime"     TEXT NOT NULL,
  "casualLeaveCutoff" TEXT NOT NULL,
  "halfDayCutoff"     TEXT NOT NULL,
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendancePolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendancePolicy_officeId_key" UNIQUE ("officeId"),
  CONSTRAINT "AttendancePolicy_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 12. Create TeamLead table
CREATE TABLE IF NOT EXISTS "TeamLead" (
  "teamId"    INTEGER NOT NULL,
  "userId"    UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamLead_pkey" PRIMARY KEY ("teamId", "userId"),
  CONSTRAINT "TeamLead_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TeamLead_userId_idx" ON "TeamLead"("userId");

-- 13. Create TeamLeadAdvisor table
CREATE TABLE IF NOT EXISTS "TeamLeadAdvisor" (
  "teamLeadId" UUID NOT NULL,
  "advisorId"  UUID NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamLeadAdvisor_pkey" PRIMARY KEY ("teamLeadId", "advisorId"),
  CONSTRAINT "TeamLeadAdvisor_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamLeadAdvisor_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TeamLeadAdvisor_advisorId_idx" ON "TeamLeadAdvisor"("advisorId");
