import { Test, TestingModule } from '@nestjs/testing';
import { TpcService } from './tpc.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { UserStatus } from '@prisma/client';
import { USER_SAFE_SELECT } from 'src/common/constants/constants.user';

describe('TpcService - User Selection Rules', () => {
  let service: TpcService;
  let prisma: PrismaService;

  const mockUsers = [
    {
      id: 'user-1',
      firstName: 'Super',
      lastName: 'Admin',
      email: 'admin@gmail.com',
      username: 'superadmin',
      status: UserStatus.ACTIVE,
      roleId: 1,
      role: { id: 1, name: 'SUPER_ADMIN', description: 'Super Admin' },
    },
    {
      id: 'user-2',
      firstName: 'Mohit',
      lastName: 'Sharma',
      email: 'mohit@gmail.com',
      username: 'mohit',
      status: UserStatus.ACTIVE,
      roleId: 2,
      role: { id: 2, name: 'MANAGER', description: 'Manager' },
    },
    {
      id: 'user-3',
      firstName: 'Rahul',
      lastName: 'Sharma',
      email: 'rahul@gmail.com',
      username: 'rahul',
      status: UserStatus.ACTIVE,
      roleId: 3,
      role: { id: 3, name: 'TEAM_LEAD', description: 'Team Lead 1' },
    },
    {
      id: 'user-4',
      firstName: 'Vikram',
      lastName: 'Singh',
      email: 'vikram@gmail.com',
      username: 'vikram',
      status: UserStatus.ACTIVE,
      roleId: 3,
      role: { id: 3, name: 'TEAM_LEAD', description: 'Team Lead 2' },
    },
    {
      id: 'user-5',
      firstName: 'Damini',
      lastName: 'Singh',
      email: 'damini@gmail.com',
      username: 'damini',
      status: UserStatus.ACTIVE,
      roleId: 4,
      role: { id: 4, name: 'PROGRAM_ADVISOR', description: 'Program Advisor 1' },
    },
    {
      id: 'user-6',
      firstName: 'Amit',
      lastName: 'Kumar',
      email: 'amit@gmail.com',
      username: 'amit',
      status: UserStatus.ACTIVE,
      roleId: 4,
      role: { id: 4, name: 'PROGRAM_ADVISOR', description: 'Program Advisor 2' },
    },
    {
      id: 'user-7',
      firstName: 'Pooja',
      lastName: 'Verma',
      email: 'pooja@gmail.com',
      username: 'pooja',
      status: UserStatus.ACTIVE,
      roleId: 4,
      role: { id: 4, name: 'PROGRAM_ADVISOR', description: 'Program Advisor 3' },
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TpcService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn().mockResolvedValue(mockUsers),
            },
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TpcService>(TpcService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should query for active users where role is NOT HR', async () => {
    const users = await service.getSelectableUsers();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        status: UserStatus.ACTIVE,
        role: {
          name: {
            not: 'HR',
          },
        },
      },
      select: USER_SAFE_SELECT,
      orderBy: [
        { firstName: 'asc' },
        { lastName: 'asc' },
      ],
    });

    expect(users).toHaveLength(7);
    const roleNames = users.map((u) => u.role.name);
    expect(roleNames).not.toContain('HR');
    expect(roleNames).toEqual([
      'SUPER_ADMIN',
      'MANAGER',
      'TEAM_LEAD',
      'TEAM_LEAD',
      'PROGRAM_ADVISOR',
      'PROGRAM_ADVISOR',
      'PROGRAM_ADVISOR',
    ]);
  });
});
