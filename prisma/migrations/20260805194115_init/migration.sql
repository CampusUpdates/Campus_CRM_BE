-- CreateEnum
CREATE TYPE "DataUploadStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DataAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "DataUpload" (
    "id" SERIAL NOT NULL,
    "uploadedById" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "totalRecords" INTEGER NOT NULL,
    "status" "DataUploadStatus" NOT NULL DEFAULT 'PROCESSING',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentData" (
    "id" SERIAL NOT NULL,
    "uploadId" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataAssignment" (
    "id" SERIAL NOT NULL,
    "assignedToId" INTEGER NOT NULL,
    "assignedById" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "DataAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataAssignmentItem" (
    "id" SERIAL NOT NULL,
    "dataAssignmentId" INTEGER NOT NULL,
    "studentDataId" INTEGER NOT NULL,

    CONSTRAINT "DataAssignmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataUpload_uploadedById_idx" ON "DataUpload"("uploadedById");

-- CreateIndex
CREATE INDEX "StudentData_uploadId_idx" ON "StudentData"("uploadId");

-- CreateIndex
CREATE INDEX "StudentData_phone_idx" ON "StudentData"("phone");

-- CreateIndex
CREATE INDEX "DataAssignment_assignedToId_idx" ON "DataAssignment"("assignedToId");

-- CreateIndex
CREATE INDEX "DataAssignment_assignedById_idx" ON "DataAssignment"("assignedById");

-- CreateIndex
CREATE INDEX "DataAssignmentItem_studentDataId_idx" ON "DataAssignmentItem"("studentDataId");

-- CreateIndex
CREATE UNIQUE INDEX "DataAssignmentItem_dataAssignmentId_studentDataId_key" ON "DataAssignmentItem"("dataAssignmentId", "studentDataId");

-- AddForeignKey
ALTER TABLE "DataUpload" ADD CONSTRAINT "DataUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentData" ADD CONSTRAINT "StudentData_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "DataUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAssignment" ADD CONSTRAINT "DataAssignment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAssignment" ADD CONSTRAINT "DataAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAssignmentItem" ADD CONSTRAINT "DataAssignmentItem_dataAssignmentId_fkey" FOREIGN KEY ("dataAssignmentId") REFERENCES "DataAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAssignmentItem" ADD CONSTRAINT "DataAssignmentItem_studentDataId_fkey" FOREIGN KEY ("studentDataId") REFERENCES "StudentData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
