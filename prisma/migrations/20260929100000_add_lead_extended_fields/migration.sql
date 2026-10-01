-- ============================================================
-- MIGRATION: Add extended fields to Lead model
-- ============================================================
-- This migration only adds new nullable columns to "Lead".
-- No existing columns are modified, renamed, or dropped.
-- All new columns are nullable so existing records remain valid.
-- ============================================================

-- Family Information
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "fatherName"        TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "fatherOccupation"  TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "motherName"        TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "motherOccupation"  TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "physicalAddress"   TEXT;

-- 10th Academic Information
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "tenthSchoolName"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "tenthBoard"        TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "tenthPassoutYear"  INTEGER;

-- 12th Academic Information
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "twelfthSchoolName"  TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "twelfthBoard"       TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "twelfthPassoutYear" INTEGER;

-- Graduation Information
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "graduationCollegeName"  TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "graduationStream"       TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "graduationUniversity"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "graduationPassoutYear"  INTEGER;

-- Calling / Notes
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "bestTimeToCall" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "notes"          TEXT;
