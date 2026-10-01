const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.lead.groupBy({
    by: ['source'],
    _count: {
      source: true,
    },
  });
  console.log(groups);
}
main().catch(console.error).finally(() => prisma.$disconnect());
