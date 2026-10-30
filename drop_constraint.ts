import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe('ALTER TABLE "LeadNegativeCollege" DROP CONSTRAINT IF EXISTS "LeadNegativeCollege_leadId_collegeName_key";');
  console.log("Constraint dropped.");
}
main().catch(console.error).finally(() => prisma.$disconnect());
