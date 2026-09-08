-- CreateEnum
CREATE TYPE "ClaimRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "LeadClaimRequest" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "status" "ClaimRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedById" UUID,
    "processedAt" TIMESTAMP(3),
    "remarks" TEXT,

    CONSTRAINT "LeadClaimRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadClaimRequest_leadId_idx" ON "LeadClaimRequest"("leadId");

-- CreateIndex
CREATE INDEX "LeadClaimRequest_requestedById_idx" ON "LeadClaimRequest"("requestedById");

-- CreateIndex
CREATE INDEX "LeadClaimRequest_status_idx" ON "LeadClaimRequest"("status");

-- AddForeignKey
ALTER TABLE "LeadClaimRequest" ADD CONSTRAINT "LeadClaimRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadClaimRequest" ADD CONSTRAINT "LeadClaimRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadClaimRequest" ADD CONSTRAINT "LeadClaimRequest_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
