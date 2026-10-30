import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const item = await prisma.dataAssignmentItem.findFirst({ include: { studentData: { include: { callRecords: true } } } });
  console.log(item);
}
main().catch(console.error).finally(() => prisma.$disconnect());
