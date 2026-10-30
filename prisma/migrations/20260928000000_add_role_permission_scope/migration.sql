-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('OWN', 'TEAM', 'ALL');

-- AlterTable: Add scope column to RolePermission
ALTER TABLE "RolePermission" ADD COLUMN "scope" "PermissionScope" NOT NULL DEFAULT 'ALL';

-- AlterTable: Add locationValidationEnabled column to Office
ALTER TABLE "Office" ADD COLUMN "locationValidationEnabled" BOOLEAN NOT NULL DEFAULT true;
