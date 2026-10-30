const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Executing migration...');
  await prisma.$executeRawUnsafe(`ALTER TABLE "Lead" ADD COLUMN "courseInterestedOther" TEXT;`);
  console.log('Done.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
