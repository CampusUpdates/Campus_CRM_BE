const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Terminating other connections...');
  await prisma.$executeRawUnsafe(`
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = current_database()
      AND usename = current_user
      AND pid <> pg_backend_pid();
  `);
  console.log('Done.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
