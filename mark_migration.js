const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const fs = require('fs');

async function main() {
  const sql = fs.readFileSync('prisma/migrations/20260930100000_update_lead_source/migration.sql', 'utf8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  
  await prisma.$executeRawUnsafe(`
    INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
    VALUES (gen_random_uuid()::varchar, '${checksum}', NOW(), '20260930100000_update_lead_source', '', NULL, NOW(), 1)
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log('Migration marked as applied.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
