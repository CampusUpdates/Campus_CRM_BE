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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ActivityLogService, useValue: mockActivityLogService },
        {
          provide: TeamLeadAuthorizationService,
          useValue: {
            isTeamLead: jest.fn().mockResolvedValue(false),
            getTeamLeadAdvisorIds: jest.fn().mockResolvedValue([]),
            getTeamLeadAssignedTeamIds: jest.fn().mockResolvedValue([]),
            canTeamLeadAccessTeam: jest.fn().mockResolvedValue(false),
            canTeamLeadAccessAdvisor: jest.fn().mockResolvedValue(false),
            canTeamLeadAccessLead: jest.fn().mockResolvedValue(false),
          },
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
      ).rejects.toThrow(ConflictException);
    });
  });
});
