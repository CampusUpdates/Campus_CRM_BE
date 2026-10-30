import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { TeamLeadAuthorizationService } from 'src/teams/team-lead-authorization.service';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

describe('UsersService - Single Super Admin Enforcements', () => {
  let service: UsersService;
  let prisma: PrismaService;

  const mockPrismaService = {
    role: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    team: {
      findMany: jest.fn(),
    },
    teamLead: {
      findMany: jest.fn(),
    },
    teamLeadAdvisor: {
      findMany: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-token'),
  };

  const mockActivityLogService = {
    createLog: jest.fn().mockResolvedValue(true),
  };

  const mockTeamLeadAuthService = {
    isTeamLead: jest.fn().mockResolvedValue(false),
    getTeamLeadAdvisorIds: jest.fn().mockResolvedValue([]),
    getTeamLeadAssignedTeamIds: jest.fn().mockResolvedValue([]),
    canTeamLeadAccessTeam: jest.fn().mockResolvedValue(false),
    canTeamLeadAccessAdvisor: jest.fn().mockResolvedValue(false),
    canTeamLeadAccessLead: jest.fn().mockResolvedValue(false),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ActivityLogService, useValue: mockActivityLogService },
        {
          provide: TeamLeadAuthorizationService,
          useValue: mockTeamLeadAuthService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('Create User Protections', () => {
    it('should throw 403 Forbidden when HR attempts to create a Super Admin', async () => {
      mockPrismaService.role.findUnique
        .mockResolvedValueOnce({ id: 1, name: 'SUPER_ADMIN' }) // role check
        .mockResolvedValueOnce({ id: 1, name: 'SUPER_ADMIN' }) // getSuperAdminRole
        .mockResolvedValueOnce({ id: 4, name: 'HR' }); // isUserHR check

      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'hr-user-id',
        role: { name: 'HR' },
      });

      await expect(
        service.create(
          {
            firstName: 'New',
            email: 'newadmin@crm.com',
            phone: '9998887770',
            roleId: 1,
          },
          { sub: 'hr-user-id', roleId: 4 },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw 409 Conflict when attempting to create a second active Super Admin', async () => {
      mockPrismaService.role.findUnique
        .mockResolvedValueOnce({ id: 1, name: 'SUPER_ADMIN' })
        .mockResolvedValueOnce({ id: 1, name: 'SUPER_ADMIN' });

      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'super-admin-id',
        role: { name: 'SUPER_ADMIN' },
      });
      mockPrismaService.user.count.mockResolvedValue(1); // 1 active Super Admin exists

      await expect(
        service.create(
          {
            firstName: 'Second',
            email: 'admin2@crm.com',
            phone: '9998887771',
            roleId: 1,
          },
          { sub: 'super-admin-id', roleId: 1 },
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Update User & Demotion Protections', () => {
    it('should throw 409 Conflict when attempting to demote the sole active Super Admin', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'super-admin-id',
        roleId: 1,
        status: UserStatus.ACTIVE,
        role: { id: 1, name: 'SUPER_ADMIN' },
      });
      mockPrismaService.role.findUnique
        .mockResolvedValueOnce({ id: 1, name: 'SUPER_ADMIN' })
        .mockResolvedValueOnce({ id: 2, name: 'Manager' });
      mockPrismaService.user.count.mockResolvedValue(1);

      await expect(
        service.update('super-admin-id', { roleId: 2 }, 'super-admin-id'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 409 Conflict when attempting to deactivate the sole active Super Admin', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'super-admin-id',
        roleId: 1,
        status: UserStatus.ACTIVE,
        role: { id: 1, name: 'SUPER_ADMIN' },
      });
      mockPrismaService.role.findUnique.mockResolvedValue({
        id: 1,
        name: 'SUPER_ADMIN',
      });
      mockPrismaService.user.count.mockResolvedValue(1);

      await expect(
        service.updateStatus('super-admin-id', UserStatus.INACTIVE, 'other-id'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll Authorization Scoping', () => {
    it('1. Super Admin sees all users', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'super-admin-id',
        role: { name: 'SUPER_ADMIN' },
      });
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'u1' },
        { id: 'u2' },
      ]);

      const result = await service.findAll({ sub: 'super-admin-id' });

      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: {},
        select: expect.any(Object),
      });
      expect(result).toHaveLength(2);
    });

    it('2. Manager sees only team scope users and themselves', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'manager-id',
        role: { name: 'Manager' },
        teamId: 10,
      });
      mockPrismaService.team.findMany.mockResolvedValue([{ id: 10 }]);
      mockPrismaService.user.findMany
        .mockResolvedValueOnce([{ id: 'advisor-1' }, { id: 'advisor-2' }]) // teamMembers query
        .mockResolvedValueOnce([{ id: 'manager-id' }, { id: 'advisor-1' }, { id: 'advisor-2' }, { id: 'tl-1' }, { id: 'supervised-adv-1' }]); // final query
      mockPrismaService.teamLead.findMany.mockResolvedValue([{ userId: 'tl-1' }]);
      mockPrismaService.teamLeadAdvisor.findMany.mockResolvedValue([{ advisorId: 'supervised-adv-1' }]);

      await service.findAll({ sub: 'manager-id' });

      expect(mockPrismaService.user.findMany).toHaveBeenLastCalledWith({
        where: {
          id: {
            in: expect.arrayContaining([
              'manager-id',
              'advisor-1',
              'advisor-2',
              'tl-1',
              'supervised-adv-1',
            ]),
          },
        },
        select: expect.any(Object),
      });
    });

    it('3. Team Lead sees only assigned advisors and themselves', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'tl-id',
        role: { name: 'Team Lead' },
      });
      mockPrismaService.team.findMany.mockResolvedValue([]);
      mockTeamLeadAuthService.isTeamLead.mockResolvedValue(true);
      mockTeamLeadAuthService.getTeamLeadAdvisorIds.mockResolvedValue([
        'adv-1',
        'adv-2',
      ]);
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'tl-id' },
        { id: 'adv-1' },
        { id: 'adv-2' },
      ]);

      await service.findAll({ sub: 'tl-id' });

      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: expect.arrayContaining(['tl-id', 'adv-1', 'adv-2']),
          },
        },
        select: expect.any(Object),
      });
    });

    it('4. Program Advisor sees only themselves', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'pa-id',
        role: { name: 'Program Advisor' },
      });
      mockPrismaService.team.findMany.mockResolvedValue([]);
      mockTeamLeadAuthService.isTeamLead.mockResolvedValue(false);
      mockPrismaService.user.findMany.mockResolvedValue([{ id: 'pa-id' }]);

      await service.findAll({ sub: 'pa-id' });

      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: { id: 'pa-id' },
        select: expect.any(Object),
      });
    });
  });
});
