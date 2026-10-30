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

describe('TpcService - TPC Reports Scoping & Authorization', () => {
  let service: TpcService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      team: {
        findMany: jest.fn(),
      },
      lead: {
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      tPCUser: {
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      tPC: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      tPCCall: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TpcService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
      ],
    }).compile();

    service = module.get<TpcService>(TpcService);
  });

  it('should allow Super Admin to access reports with full CRM scope', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      role: { name: 'SUPER_ADMIN' },
    });
    prisma.lead.count.mockResolvedValue(10);
    prisma.tPCUser.count.mockResolvedValue(5);
    prisma.tPC.count.mockResolvedValue(2);
    prisma.tPC.findMany.mockResolvedValue([
      { id: 'tpc-1', lead: { firstName: 'John' }, assignments: [] },
      { id: 'tpc-2', lead: { firstName: 'Jane' }, assignments: [] },
    ]);

    const result = await service.getTpcReports('admin-1', {});

    expect(result.counts.activeLeadsToday).toBe(10);
    expect(result.counts.tpcAssignedToday).toBe(5);
    expect(result.counts.notAssignedTpcs).toBe(2);
    expect(result.data).toHaveLength(2);
    // Unfiltered for super admin
    expect(prisma.tPC.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('should scope Manager reports to their managed teams and employees', async () => {
    const managerId = 'mgr-1';
    prisma.user.findUnique.mockResolvedValue({
      id: managerId,
      teamId: 10,
      role: { name: 'MANAGER' },
    });
    // Manager manages team 10
    prisma.team.findMany.mockResolvedValue([{ id: 10 }]);
    // Team 10 has members: sub-1 and mgr-1
    prisma.user.findMany.mockResolvedValue([{ id: 'sub-1' }, { id: managerId }]);

    prisma.lead.count.mockResolvedValue(4);
    prisma.tPCUser.count.mockResolvedValue(2);
    prisma.tPC.count.mockResolvedValue(1);
    prisma.tPC.findMany.mockResolvedValue([
      { id: 'tpc-mgr-1', lead: { firstName: 'Alice' }, assignments: [] },
    ]);

    const result = await service.getTpcReports(managerId, {});

    expect(result.counts.activeLeadsToday).toBe(4);
    expect(result.counts.tpcAssignedToday).toBe(2);
    expect(result.data).toHaveLength(1);
    // Scoped where clause must include manager scope
    expect(prisma.tPC.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it('should reject Manager targeting a team outside their authorized scope', async () => {
    const managerId = 'mgr-1';
    prisma.user.findUnique.mockResolvedValue({
      id: managerId,
      teamId: 10,
      role: { name: 'MANAGER' },
    });
    prisma.team.findMany.mockResolvedValue([{ id: 10 }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'sub-1' }, { id: managerId }]);

    // Manager attempts to pass teamId: 99
    await expect(
      service.getTpcReports(managerId, { teamId: 99 }),
    ).rejects.toThrow('Access denied: You cannot view TPC reports for teams outside your authorized scope.');
  });

  it('should reject Manager targeting an employee outside their authorized scope', async () => {
    const managerId = 'mgr-1';
    prisma.user.findUnique.mockResolvedValue({
      id: managerId,
      teamId: 10,
      role: { name: 'MANAGER' },
    });
    prisma.team.findMany.mockResolvedValue([{ id: 10 }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'sub-1' }, { id: managerId }]);

    // Manager attempts to pass userId: 'intruder-user'
    await expect(
      service.getTpcReports(managerId, { userId: 'intruder-user' }),
    ).rejects.toThrow('Access denied: You cannot view TPC reports for employees outside your authorized scope.');
  });

  it('should reject unauthorized roles from accessing TPC reports', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'advisor-1',
      role: { name: 'PROGRAM_ADVISOR' },
    });

    await expect(
      service.getTpcReports('advisor-1', {}),
    ).rejects.toThrow('Access denied: You are not authorized to view TPC reports');
  });

  it('should reject Manager viewing history for a lead outside their authorized scope', async () => {
    const managerId = 'mgr-1';
    prisma.user.findUnique.mockResolvedValue({
      id: managerId,
      teamId: 10,
      role: { name: 'MANAGER' },
    });
    prisma.team.findMany.mockResolvedValue([{ id: 10 }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'sub-1' }, { id: managerId }]);

    // Lead belongs to team 99 created by user-99
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-99',
      teamId: 99,
      createdById: 'user-99',
      assignments: [],
    });
    prisma.tPC.findFirst.mockResolvedValue({
      id: 'tpc-99',
      leadId: 'lead-99',
      assignments: [],
    });

    await expect(
      service.getTpcHistoryForLead('lead-99', managerId),
    ).rejects.toThrow('Access denied: You cannot view history for this lead.');
  });

  it('should reject Manager viewing history for an assignment outside their authorized scope', async () => {
    const managerId = 'mgr-1';
    prisma.user.findUnique.mockResolvedValue({
      id: managerId,
      teamId: 10,
      role: { name: 'MANAGER' },
    });
    prisma.team.findMany.mockResolvedValue([{ id: 10 }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'sub-1' }, { id: managerId }]);

    // Assignment belongs to user-99 and team 99
    prisma.tPCUser.findUnique.mockResolvedValue({
      id: 'assign-99',
      assignedToId: 'user-99',
      assignedById: 'user-99',
      completedById: null,
      tpc: {
        lead: {
          id: 'lead-99',
          teamId: 99,
          createdById: 'user-99',
          assignments: [],
        },
      },
    });

    await expect(
      service.getTpcHistoryForAssignment('assign-99', managerId),
    ).rejects.toThrow('Access denied: You cannot view history for this TPC assignment.');
  });
});
