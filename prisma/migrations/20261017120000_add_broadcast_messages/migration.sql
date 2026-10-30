-- CreateTable
CREATE TABLE IF NOT EXISTS "BroadcastMessage" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "targetRoles" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "targetTeams" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "targetUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetAll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BroadcastRecipient" (
    "id" UUID NOT NULL,
    "broadcastId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BroadcastMessage_createdById_idx" ON "BroadcastMessage"("createdById");
CREATE INDEX IF NOT EXISTS "BroadcastMessage_createdAt_idx" ON "BroadcastMessage"("createdAt");
CREATE INDEX IF NOT EXISTS "BroadcastMessage_status_idx" ON "BroadcastMessage"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_idx" ON "BroadcastRecipient"("broadcastId");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_userId_idx" ON "BroadcastRecipient"("userId");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_readAt_idx" ON "BroadcastRecipient"("readAt");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_acknowledgedAt_idx" ON "BroadcastRecipient"("acknowledgedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_userId_key" ON "BroadcastRecipient"("broadcastId", "userId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BroadcastMessage_createdById_fkey'
    ) THEN
        ALTER TABLE "BroadcastMessage" ADD CONSTRAINT "BroadcastMessage_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BroadcastRecipient_broadcastId_fkey'
    ) THEN
        ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey"
        FOREIGN KEY ("broadcastId") REFERENCES "BroadcastMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BroadcastRecipient_userId_fkey'
    ) THEN
        ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
