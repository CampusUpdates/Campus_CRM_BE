-- CreateEnum
CREATE TYPE "LeadAssignmentStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'GOOGLE', 'REFERRAL', 'DATA_UPLOAD', 'COLLEGE_EVENT', 'OTHER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateTable
CREATE TABLE "LeadStatus" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" SERIAL NOT NULL,
    "statusId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "email" TEXT,
    "gender" "Gender",
    "dateOfBirth" DATE,
    "city" TEXT,
    "state" TEXT,
    "tenthPercentage" DOUBLE PRECISION,
    "twelfthPercentage" DOUBLE PRECISION,
    "graduationPercentage" DOUBLE PRECISION,
    "graduationCourse" TEXT,
    "graduationSpecialization" TEXT,
    "courseInterested" "CourseType",
    "specializationInterested" TEXT,
    "passingYear" INTEGER,
    "source" "LeadSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "LeadAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadStatus_name_key" ON "LeadStatus"("name");

-- CreateIndex
CREATE INDEX "Lead_statusId_idx" ON "Lead"("statusId");

-- CreateIndex
CREATE INDEX "Lead_createdById_idx" ON "Lead"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAssignment_leadId_userId_assignedAt_key" ON "LeadAssignment"("leadId", "userId", "assignedAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "LeadStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
