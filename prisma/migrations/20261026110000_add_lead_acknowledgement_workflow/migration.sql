-- CreateTable
CREATE TABLE IF NOT EXISTS "LeadAcknowledgement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "leadId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "acknowledgedById" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "sharedById" UUID,
    "sharedAt" TIMESTAMP(3),
    "channel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- Unique index to prevent duplicate acknowledgement records per lead + recipient
CREATE UNIQUE INDEX IF NOT EXISTS "unique_lead_recipient_acknowledgement"
ON "LeadAcknowledgement"("leadId", "recipientId");

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "LeadAcknowledgement_leadId_idx" ON "LeadAcknowledgement"("leadId");
CREATE INDEX IF NOT EXISTS "LeadAcknowledgement_recipientId_idx" ON "LeadAcknowledgement"("recipientId");
CREATE INDEX IF NOT EXISTS "LeadAcknowledgement_acknowledgedAt_idx" ON "LeadAcknowledgement"("acknowledgedAt");

-- Foreign key constraints
DO $$ BEGIN
    ALTER TABLE "LeadAcknowledgement" ADD CONSTRAINT "LeadAcknowledgement_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "LeadAcknowledgement" ADD CONSTRAINT "LeadAcknowledgement_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "LeadAcknowledgement" ADD CONSTRAINT "LeadAcknowledgement_acknowledgedById_fkey"
    FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "LeadAcknowledgement" ADD CONSTRAINT "LeadAcknowledgement_sharedById_fkey"
    FOREIGN KEY ("sharedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
