-- DropEnum
DROP TYPE "LeadStatusType";

-- CreateTable
CREATE TABLE "LeadCollege" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "collegeId" UUID NOT NULL,
    "statusId" INTEGER NOT NULL,
    "processedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCollege_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadCollege_leadId_idx" ON "LeadCollege"("leadId");

-- CreateIndex
CREATE INDEX "LeadCollege_collegeId_idx" ON "LeadCollege"("collegeId");

-- CreateIndex
CREATE INDEX "LeadCollege_statusId_idx" ON "LeadCollege"("statusId");

-- CreateIndex
CREATE INDEX "LeadCollege_processedById_idx" ON "LeadCollege"("processedById");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCollege_leadId_collegeId_key" ON "LeadCollege"("leadId", "collegeId");

-- AddForeignKey
ALTER TABLE "LeadCollege" ADD CONSTRAINT "LeadCollege_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCollege" ADD CONSTRAINT "LeadCollege_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCollege" ADD CONSTRAINT "LeadCollege_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "LeadStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCollege" ADD CONSTRAINT "LeadCollege_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
