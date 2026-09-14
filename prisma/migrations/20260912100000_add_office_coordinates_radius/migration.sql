-- AlterTable: Add latitude, longitude, radiusMeters to Office table
ALTER TABLE "Office" 
ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "radiusMeters" INTEGER NOT NULL DEFAULT 100;
