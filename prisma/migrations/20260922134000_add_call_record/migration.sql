-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('NO_ANSWER', 'WRONG_NUMBER', 'NOT_INTERESTED', 'FOLLOW_UP', 'CALL_BACK_LATER', 'INTERESTED');

-- CreateTable
CREATE TABLE "CallRecord" (
    "id" UUID NOT NULL,
    "studentDataId" UUID NOT NULL,
    "leadId" UUID,
    "createdById" UUID NOT NULL,
    "outcome" "CallOutcome" NOT NULL,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallRecord_studentDataId_idx" ON "CallRecord"("studentDataId");

-- CreateIndex
CREATE INDEX "CallRecord_leadId_idx" ON "CallRecord"("leadId");

-- CreateIndex
CREATE INDEX "CallRecord_createdById_idx" ON "CallRecord"("createdById");

-- CreateIndex
CREATE INDEX "CallRecord_createdAt_idx" ON "CallRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_studentDataId_fkey" FOREIGN KEY ("studentDataId") REFERENCES "StudentData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
