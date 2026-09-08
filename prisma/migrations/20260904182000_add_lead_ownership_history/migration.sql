-- CreateEnum
CREATE TYPE "OwnershipChangeReason" AS ENUM ('INITIAL_ASSIGNMENT', 'CLAIM_APPROVED', 'ADMIN_REASSIGNMENT');

-- CreateTable
CREATE TABLE "LeadOwnershipHistory" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "previousOwnerId" UUID,
    "newOwnerId" UUID NOT NULL,
    "changedById" UUID,
    "reason" "OwnershipChangeReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadOwnershipHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadOwnershipHistory_leadId_idx" ON "LeadOwnershipHistory"("leadId");

-- CreateIndex
CREATE INDEX "LeadOwnershipHistory_newOwnerId_idx" ON "LeadOwnershipHistory"("newOwnerId");

-- CreateIndex
CREATE INDEX "LeadOwnershipHistory_createdAt_idx" ON "LeadOwnershipHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "LeadOwnershipHistory" ADD CONSTRAINT "LeadOwnershipHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadOwnershipHistory" ADD CONSTRAINT "LeadOwnershipHistory_previousOwnerId_fkey" FOREIGN KEY ("previousOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadOwnershipHistory" ADD CONSTRAINT "LeadOwnershipHistory_newOwnerId_fkey" FOREIGN KEY ("newOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadOwnershipHistory" ADD CONSTRAINT "LeadOwnershipHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
