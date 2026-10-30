const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: {
          name: {
            not: 'HR',
          },
        },
      },
      select: { id: true, firstName: true, email: true },
      orderBy: [
        { firstName: 'asc' },
        { lastName: 'asc' },
      ],
    });
  console.log("Users returned by prisma:", users);
}
main();
