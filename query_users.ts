import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({
    include: { role: true },
  });
  console.log(JSON.stringify(users.map(u => ({ id: u.id, status: u.status, role: u.role?.name })), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
