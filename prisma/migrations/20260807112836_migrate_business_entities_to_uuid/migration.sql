/*
  Warnings:

  - The primary key for the `ActivityLog` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Attachment` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Attendance` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Candidate` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `College` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `approvedById` column on the `College` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `CollegeCompetitor` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `DataAssignment` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `DataUpload` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Interaction` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Interview` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Lead` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Notification` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `NotificationRecipient` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `StudentData` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `TPC` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `TPCUser` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `managerId` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `id` on the `ActivityLog` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `ActivityLog` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `Attachment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `interactionId` on the `Attachment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `uploadedById` on the `Attachment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `Attendance` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `Attendance` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `Candidate` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `College` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `CollegeCompetitor` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `collegeId` on the `CollegeCompetitor` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `competitorCollegeId` on the `CollegeCompetitor` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `collegeId` on the `Course` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `DataAssignment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `assignedToId` on the `DataAssignment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `assignedById` on the `DataAssignment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `dataAssignmentId` on the `DataAssignmentItem` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `studentDataId` on the `DataAssignmentItem` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `DataUpload` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `uploadedById` on the `DataUpload` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `Interaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `leadId` on the `Interaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `createdById` on the `Interaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `Interview` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `candidateId` on the `Interview` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `interviewerId` to the `Interview` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `id` on the `Lead` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `createdById` on the `Lead` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `leadId` on the `LeadAssignment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `LeadAssignment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `Notification` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `NotificationRecipient` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `notificationId` on the `NotificationRecipient` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `NotificationRecipient` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `StudentData` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `uploadId` on the `StudentData` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `TPC` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `leadId` on the `TPC` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `assignedToId` on the `TPC` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `TPCUser` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tpcId` on the `TPCUser` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `TPCUser` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `User` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_interactionId_fkey";

-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_userId_fkey";

-- DropForeignKey
ALTER TABLE "College" DROP CONSTRAINT "College_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "CollegeCompetitor" DROP CONSTRAINT "CollegeCompetitor_collegeId_fkey";

-- DropForeignKey
ALTER TABLE "CollegeCompetitor" DROP CONSTRAINT "CollegeCompetitor_competitorCollegeId_fkey";

-- DropForeignKey
ALTER TABLE "Course" DROP CONSTRAINT "Course_collegeId_fkey";

-- DropForeignKey
ALTER TABLE "DataAssignment" DROP CONSTRAINT "DataAssignment_assignedById_fkey";

-- DropForeignKey
ALTER TABLE "DataAssignment" DROP CONSTRAINT "DataAssignment_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "DataAssignmentItem" DROP CONSTRAINT "DataAssignmentItem_dataAssignmentId_fkey";

-- DropForeignKey
ALTER TABLE "DataAssignmentItem" DROP CONSTRAINT "DataAssignmentItem_studentDataId_fkey";

-- DropForeignKey
ALTER TABLE "DataUpload" DROP CONSTRAINT "DataUpload_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "Interaction" DROP CONSTRAINT "Interaction_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Interaction" DROP CONSTRAINT "Interaction_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Interview" DROP CONSTRAINT "Interview_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "Interview" DROP CONSTRAINT "Interview_interviewerId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_createdById_fkey";

-- DropForeignKey
ALTER TABLE "LeadAssignment" DROP CONSTRAINT "LeadAssignment_leadId_fkey";

-- DropForeignKey
ALTER TABLE "LeadAssignment" DROP CONSTRAINT "LeadAssignment_userId_fkey";

-- DropForeignKey
ALTER TABLE "NotificationRecipient" DROP CONSTRAINT "NotificationRecipient_notificationId_fkey";

-- DropForeignKey
ALTER TABLE "NotificationRecipient" DROP CONSTRAINT "NotificationRecipient_userId_fkey";

-- DropForeignKey
ALTER TABLE "StudentData" DROP CONSTRAINT "StudentData_uploadId_fkey";

-- DropForeignKey
ALTER TABLE "TPC" DROP CONSTRAINT "TPC_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "TPC" DROP CONSTRAINT "TPC_leadId_fkey";

-- DropForeignKey
ALTER TABLE "TPCUser" DROP CONSTRAINT "TPCUser_tpcId_fkey";

-- DropForeignKey
ALTER TABLE "TPCUser" DROP CONSTRAINT "TPCUser_userId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_managerId_fkey";

-- AlterTable
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL,
ALTER COLUMN "entityId" SET DATA TYPE TEXT,
ADD CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "interactionId",
ADD COLUMN     "interactionId" UUID NOT NULL,
DROP COLUMN "uploadedById",
ADD COLUMN     "uploadedById" UUID NOT NULL,
ADD CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL,
ADD CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Candidate" DROP CONSTRAINT "Candidate_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "College" DROP CONSTRAINT "College_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "approvedById",
ADD COLUMN     "approvedById" UUID,
ALTER COLUMN "isActive" SET DEFAULT false,
ADD CONSTRAINT "College_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "CollegeCompetitor" DROP CONSTRAINT "CollegeCompetitor_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "collegeId",
ADD COLUMN     "collegeId" UUID NOT NULL,
DROP COLUMN "competitorCollegeId",
ADD COLUMN     "competitorCollegeId" UUID NOT NULL,
ADD CONSTRAINT "CollegeCompetitor_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Course" DROP COLUMN "collegeId",
ADD COLUMN     "collegeId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "DataAssignment" DROP CONSTRAINT "DataAssignment_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "assignedToId",
ADD COLUMN     "assignedToId" UUID NOT NULL,
DROP COLUMN "assignedById",
ADD COLUMN     "assignedById" UUID NOT NULL,
ADD CONSTRAINT "DataAssignment_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "DataAssignmentItem" DROP COLUMN "dataAssignmentId",
ADD COLUMN     "dataAssignmentId" UUID NOT NULL,
DROP COLUMN "studentDataId",
ADD COLUMN     "studentDataId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "DataUpload" DROP CONSTRAINT "DataUpload_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "uploadedById",
ADD COLUMN     "uploadedById" UUID NOT NULL,
ADD CONSTRAINT "DataUpload_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Interaction" DROP CONSTRAINT "Interaction_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "leadId",
ADD COLUMN     "leadId" UUID NOT NULL,
DROP COLUMN "createdById",
ADD COLUMN     "createdById" UUID NOT NULL,
ADD CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Interview" DROP CONSTRAINT "Interview_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "candidateId",
ADD COLUMN     "candidateId" UUID NOT NULL,
DROP COLUMN "interviewerId",
ADD COLUMN     "interviewerId" UUID NOT NULL,
ADD CONSTRAINT "Interview_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "createdById",
ADD COLUMN     "createdById" UUID NOT NULL,
ADD CONSTRAINT "Lead_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "LeadAssignment" DROP COLUMN "leadId",
ADD COLUMN     "leadId" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "Notification_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "NotificationRecipient" DROP CONSTRAINT "NotificationRecipient_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "notificationId",
ADD COLUMN     "notificationId" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL,
ADD CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "StudentData" DROP CONSTRAINT "StudentData_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "uploadId",
ADD COLUMN     "uploadId" UUID NOT NULL,
ADD CONSTRAINT "StudentData_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "TPC" DROP CONSTRAINT "TPC_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "leadId",
ADD COLUMN     "leadId" UUID NOT NULL,
DROP COLUMN "assignedToId",
ADD COLUMN     "assignedToId" UUID NOT NULL,
ADD CONSTRAINT "TPC_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "TPCUser" DROP CONSTRAINT "TPCUser_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tpcId",
ADD COLUMN     "tpcId" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL,
ADD CONSTRAINT "TPCUser_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "User" DROP CONSTRAINT "User_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "managerId",
ADD COLUMN     "managerId" UUID,
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

-- CreateIndex
CREATE INDEX "Attachment_interactionId_idx" ON "Attachment"("interactionId");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_userId_date_key" ON "Attendance"("userId", "date");

-- CreateIndex
CREATE INDEX "College_approvedById_idx" ON "College"("approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "CollegeCompetitor_collegeId_competitorCollegeId_key" ON "CollegeCompetitor"("collegeId", "competitorCollegeId");

-- CreateIndex
CREATE INDEX "DataAssignment_assignedToId_idx" ON "DataAssignment"("assignedToId");

-- CreateIndex
CREATE INDEX "DataAssignment_assignedById_idx" ON "DataAssignment"("assignedById");

-- CreateIndex
CREATE INDEX "DataAssignmentItem_studentDataId_idx" ON "DataAssignmentItem"("studentDataId");

-- CreateIndex
CREATE UNIQUE INDEX "DataAssignmentItem_dataAssignmentId_studentDataId_key" ON "DataAssignmentItem"("dataAssignmentId", "studentDataId");

-- CreateIndex
CREATE INDEX "DataUpload_uploadedById_idx" ON "DataUpload"("uploadedById");

-- CreateIndex
CREATE INDEX "Interaction_leadId_idx" ON "Interaction"("leadId");

-- CreateIndex
CREATE INDEX "Interaction_createdById_idx" ON "Interaction"("createdById");

-- CreateIndex
CREATE INDEX "Interview_candidateId_idx" ON "Interview"("candidateId");

-- CreateIndex
CREATE INDEX "Interview_interviewerId_idx" ON "Interview"("interviewerId");

-- CreateIndex
CREATE INDEX "Lead_createdById_idx" ON "Lead"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAssignment_leadId_userId_assignedAt_key" ON "LeadAssignment"("leadId", "userId", "assignedAt");

-- CreateIndex
CREATE INDEX "NotificationRecipient_notificationId_idx" ON "NotificationRecipient"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationRecipient_userId_idx" ON "NotificationRecipient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipient_notificationId_userId_key" ON "NotificationRecipient"("notificationId", "userId");

-- CreateIndex
CREATE INDEX "StudentData_uploadId_idx" ON "StudentData"("uploadId");

-- CreateIndex
CREATE INDEX "TPCUser_tpcId_idx" ON "TPCUser"("tpcId");

-- CreateIndex
CREATE INDEX "TPCUser_userId_idx" ON "TPCUser"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollegeCompetitor" ADD CONSTRAINT "CollegeCompetitor_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollegeCompetitor" ADD CONSTRAINT "CollegeCompetitor_competitorCollegeId_fkey" FOREIGN KEY ("competitorCollegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "College" ADD CONSTRAINT "College_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TPC" ADD CONSTRAINT "TPC_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TPC" ADD CONSTRAINT "TPC_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TPCUser" ADD CONSTRAINT "TPCUser_tpcId_fkey" FOREIGN KEY ("tpcId") REFERENCES "TPC"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TPCUser" ADD CONSTRAINT "TPCUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
