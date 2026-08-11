import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {

  // Permissions

  const permissions = [
    {
      name: 'USER_CREATE',
      description: 'Create users',
    },
    {
      name: 'USER_READ',
      description: 'View users',
    },
    {
      name: 'USER_UPDATE',
      description: 'Update users',
    },
    {
      name: 'USER_DEACTIVATE',
      description: 'Deactivate users',
    },
    {
      name: 'ROLE_CREATE',
      description: 'Create roles',
    },
    {
      name: 'ROLE_READ',
      description: 'View roles',
    },
    {
      name: 'ROLE_UPDATE',
      description: 'Update roles',
    },
  ];

  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: {
        name: permission.name,
      },
      update: {
        description: permission.description,
      },
      create: permission,
    });
  }

  console.log('Permissions seeded successfully');

  // Super Admin Permissions


  const superAdminRole = await prisma.role.findUnique({
    where: {
      name: 'SUPER_ADMIN',
    },
  });

  if (!superAdminRole) {
    console.log('SUPER_ADMIN role not found');
    return;
  }

  const allPermissions = await prisma.permission.findMany();

  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: superAdminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: superAdminRole.id,
        permissionId: permission.id,
      },
    });
  }

  console.log('Super Admin permissions assigned successfully');
  const adminRole = await prisma.role.findUnique({
  where: {
    name: 'ADMIN',
  },
});

const userCreatePermission = await prisma.permission.findUnique({
  where: {
    name: 'USER_CREATE',
  },
});

const leadStatuses = [
  {
    name: 'LEAD',
    description: 'Newly created lead',
    displayOrder: 1,
    color: 'blue',
  },
  {
    name: 'APPLICATION',
    description: 'Application process started',
    displayOrder: 2,
    color: 'yellow',
  },
  {
    name: 'INTERVIEW_SCHEDULED',
    description: 'Interview has been scheduled',
    displayOrder: 3,
    color: 'orange',
  },
  {
    name: 'INTERVIEW_DONE',
    description: 'Interview has been completed',
    displayOrder: 4,
    color: 'purple',
  },
  {
    name: 'LETTER_OUT',
    description: 'Offer or admission letter has been issued',
    displayOrder: 5,
    color: 'pink',
  },
  {
    name: 'ADMISSION_DONE',
    description: 'Admission has been completed',
    displayOrder: 6,
    color: 'green',
  },
  {
  name: 'CANCELLED',
  description: 'Admission has been cancelled',
  displayOrder: 7,
  color: 'red',
},
];

for (const status of leadStatuses) {
  await prisma.leadStatus.upsert({
    where: {
      name: status.name,
    },
    update: {
      description: status.description,
      displayOrder: status.displayOrder,
      color: status.color,
    },
    create: status,
  });
}

console.log('Lead statuses seeded successfully');

}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });