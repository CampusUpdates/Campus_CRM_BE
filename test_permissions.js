const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const permissions = await prisma.permission.findMany();
  console.log("Permissions:", permissions.map(p => p.name));
}
main().catch(console.error).finally(() => prisma.$disconnect());
