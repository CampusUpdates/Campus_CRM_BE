const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const res = await prisma.$queryRawUnsafe(`
    SELECT pid, mode, granted
    FROM pg_locks
    WHERE relation = '"Lead"'::regclass;
  `);
  console.log(res);
}
main().catch(console.error).finally(() => prisma.$disconnect());
