-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "teamId" INTEGER;

-- CreateTable
CREATE TABLE "TeamLead" (
    "teamId" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamLead_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "TeamLeadAdvisor" (
    "teamLeadId" UUID NOT NULL,
    "advisorId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamLeadAdvisor_pkey" PRIMARY KEY ("teamLeadId","advisorId")
);

-- CreateIndex
CREATE INDEX "TeamLead_userId_idx" ON "TeamLead"("userId");

-- CreateIndex
CREATE INDEX "TeamLeadAdvisor_advisorId_idx" ON "TeamLeadAdvisor"("advisorId");

-- CreateIndex
CREATE INDEX "Lead_teamId_idx" ON "Lead"("teamId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLead" ADD CONSTRAINT "TeamLead_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLead" ADD CONSTRAINT "TeamLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeadAdvisor" ADD CONSTRAINT "TeamLeadAdvisor_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeadAdvisor" ADD CONSTRAINT "TeamLeadAdvisor_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
