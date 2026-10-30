const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const statuses = await prisma.leadStatus.findMany();
  console.log("Statuses:");
  statuses.forEach(s => console.log(s.name, s.color));
}
main().catch(console.error).finally(() => prisma.$disconnect());
