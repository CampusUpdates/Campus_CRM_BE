-- AlterTable
ALTER TABLE "TPCCall" ALTER COLUMN "outcome" TYPE "CallOutcome" USING (
  CASE
    WHEN "outcome"::text = 'NO_REPLY' THEN 'NO_ANSWER'::"CallOutcome"
    WHEN "outcome"::text = 'NOT_INTERESTED' THEN 'NOT_INTERESTED'::"CallOutcome"
    ELSE 'NO_ANSWER'::"CallOutcome"
  END
);
