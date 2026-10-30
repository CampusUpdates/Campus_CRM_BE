import { PrismaClient, UserStatus } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({
    where: {
      status: UserStatus.ACTIVE,
      role: {
        name: {
          not: 'HR',
        },
      },
    }
  });
  console.log(users.length);
}
main().catch(console.error).finally(() => prisma.$disconnect());
