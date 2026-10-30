import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // Get the SUPER_ADMIN role
  const superAdminRole = await prisma.role.findUnique({
    where: { name: 'SUPER_ADMIN' },
  });

  if (!superAdminRole) {
    throw new Error('SUPER_ADMIN role not found. Run the main seed first.');
  }

  const passwordHash = await argon2.hash('Password@123');

  const superAdmin = await prisma.user.upsert({
    where: { username: 'superadmin' },
    update: {
      passwordHash,
      mustChangePassword: false,
    },
    create: {
      firstName: 'Super',
      lastName: 'Admin',
      email: 'superadmin@campus-crm.com',
      phone: '9999999999',
      username: 'superadmin',
      passwordHash,
      mustChangePassword: false,
      roleId: superAdminRole.id,
    },
  });

  console.log(`✅ Super Admin seeded: ${superAdmin.username} (${superAdmin.email})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
