import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { LeadSource } from '@prisma/client';

describe('LeadsService - Lead Created Notifications (PA Workflow)', () => {
  let service: LeadsService;
  let notificationsServiceMock: any;
  let prismaMock: any;
  let teamLeadAuthServiceMock: any;

  const paId = 'pa-user-1111-1111-1111';
  const otherPaId = 'pa-user-2222-2222-2222';
  const managerId = 'mgr-user-3333-3333-3333';
  const otherManagerId = 'mgr-user-9999-9999-9999';
  const teamLeadId = 'tl-user-4444-4444-4444';
  const otherTeamLeadId = 'tl-user-8888-8888-8888';
  const superAdmin1Id = 'sa-user-5555-5555-5555';
  const superAdmin2Id = 'sa-user-6666-6666-6666';

  const mockLead = {
    id: 'lead-uuid-7777-7777',
    firstName: 'Priya',
    lastName: 'Sharma',
    phone: '9876543210',
    email: 'priya@example.com',
    createdAt: new Date('2026-10-23T10:00:00Z'),
  };

  const paUserRecord = {
    id: paId,
    firstName: 'Amit',
    lastName: 'Verma',
    roleId: 2,
    role: { name: 'Program Advisor' },
    teamId: 10,
    managerId,
    team: {
      id: 10,
      name: 'MBA Alpha Team',
      managerId,
    },
  };

  beforeEach(async () => {
    notificationsServiceMock = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    teamLeadAuthServiceMock = {
      isTeamLead: jest.fn().mockResolvedValue(false),
      getTeamLeadAssignedTeamIds: jest.fn().mockResolvedValue([]),
    };

    prismaMock = {
      leadStatus: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, name: 'LEAD', isActive: true }),
        findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'LEAD', isActive: true }),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(mockLead),
        create: jest.fn().mockResolvedValue(mockLead),
        update: jest.fn().mockResolvedValue(mockLead),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === paId) return Promise.resolve(paUserRecord);
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockImplementation(({ where }) => {
          // If querying super admins
          if (where?.OR) {
            return Promise.resolve([
              { id: superAdmin1Id, status: 'ACTIVE' },
              { id: superAdmin2Id, status: 'ACTIVE' },
            ]);
          }
          // If querying candidateIds for active status
          if (where?.id?.in) {
            return Promise.resolve(
              where.id.in.map((id: string) => ({ id, status: 'ACTIVE' })),
            );
          }
          return Promise.resolve([]);
        }),
      },
      teamLeadAdvisor: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          if (where.advisorId === paId) {
            return Promise.resolve([{ teamLeadId }]);
          }
          return Promise.resolve([]);
        }),
      },
      teamLead: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          if (where.teamId === 10) {
            return Promise.resolve([{ userId: teamLeadId }]);
          }
          return Promise.resolve([]);
        }),
      },
      team: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 10) {
            return Promise.resolve({ id: 10, name: 'MBA Alpha Team', managerId });
          }
          return Promise.resolve(null);
        }),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({ id: 'act-1' }),
      },
      leadAssignment: {
        create: jest.fn().mockResolvedValue({ id: 'assign-1' }),
      },
      leadOwnershipHistory: {
        create: jest.fn().mockResolvedValue({ id: 'own-1' }),
      },
      leadCollege: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      leadNegativeCollege: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      college: {
        findMany: jest.fn().mockResolvedValue([{ id: 'col-1', name: 'Col 1', isActive: true, hasTieUp: true }]),
      },
      $transaction: jest.fn((cb) => cb(prismaMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: notificationsServiceMock },
        { provide: TeamLeadAuthorizationService, useValue: teamLeadAuthServiceMock },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('notifyLeadCreatedByPA verification', () => {
    const baseDto: CreateLeadDto = {
      firstName: 'Priya',
      lastName: 'Sharma',
      phone: '9876543210',
      email: 'priya@example.com',
      city: 'Delhi',
      state: 'Delhi',
      source: LeadSource.OTHER,
      collegeIds: ['col-1'],
    };

    it('1. A PA creates a lead -> the appropriate Team Lead receives one notification', async () => {
      await service.create(baseDto, paId);

      expect(notificationsServiceMock.createNotification).toHaveBeenCalled();
      const callArgs = notificationsServiceMock.createNotification.mock.calls[0][0];

      expect(callArgs.title).toBe('New Lead Created');
      expect(callArgs.type).toBe('LEAD');
      expect(callArgs.recipientUserIds).toContain(teamLeadId);
      expect(callArgs.message).toContain('A new lead has been created by Amit Verma.');
      expect(callArgs.message).toContain('Student: Priya Sharma');
      expect(callArgs.message).toContain('Advisor: Amit Verma');
      expect(callArgs.message).toContain('Team: MBA Alpha Team');
      expect(callArgs.message).toContain('Created:');
      expect(callArgs.message).toContain('Lead Details: /leads');
    });

    it('2. A PA creates a lead -> the responsible Manager receives one notification', async () => {
      await service.create(baseDto, paId);

      const callArgs = notificationsServiceMock.createNotification.mock.calls[0][0];
      expect(callArgs.recipientUserIds).toContain(managerId);
    });

    it('3. A PA creates a lead -> every Super Admin receives one notification', async () => {
      await service.create(baseDto, paId);

      const callArgs = notificationsServiceMock.createNotification.mock.calls[0][0];
      expect(callArgs.recipientUserIds).toContain(superAdmin1Id);
      expect(callArgs.recipientUserIds).toContain(superAdmin2Id);
    });

    it('4. A PA creates a lead in another team -> unrelated Team Leads and Managers receive no notification', async () => {
      await service.create(baseDto, paId);

      const callArgs = notificationsServiceMock.createNotification.mock.calls[0][0];
      expect(callArgs.recipientUserIds).not.toContain(otherTeamLeadId);
      expect(callArgs.recipientUserIds).not.toContain(otherManagerId);
    });

    it('5. A failed lead creation -> no notification is generated', async () => {
      // Simulate failed lead creation (e.g. invalid status or phone conflict)
      prismaMock.leadStatus.findFirst.mockResolvedValue(null);
      prismaMock.leadStatus.findUnique.mockResolvedValue(null);

      await expect(service.create(baseDto, paId)).rejects.toThrow(NotFoundException);
      expect(notificationsServiceMock.createNotification).not.toHaveBeenCalled();
    });

    it('6. Multiple Super Admins -> each receives exactly one notification (no duplicates)', async () => {
      await service.create(baseDto, paId);

      const callArgs = notificationsServiceMock.createNotification.mock.calls[0][0];
      const superAdmin1Count = callArgs.recipientUserIds.filter((id: string) => id === superAdmin1Id).length;
      const superAdmin2Count = callArgs.recipientUserIds.filter((id: string) => id === superAdmin2Id).length;

      expect(superAdmin1Count).toBe(1);
      expect(superAdmin2Count).toBe(1);
    });

    it('7. Non-PA user creates a lead -> does NOT trigger PA Lead Posted notification', async () => {
      // Manager user creates a lead
      prismaMock.user.findUnique.mockResolvedValue({
        id: managerId,
        firstName: 'Manager',
        lastName: 'One',
        roleId: 3,
        role: { name: 'Manager' },
      });

      await service.create(baseDto, managerId);

      // Should not send PA Lead Posted notification
      expect(notificationsServiceMock.createNotification).not.toHaveBeenCalled();
    });

    it('8. Creator PA is excluded from receiving notification for their own action', async () => {
      await service.create(baseDto, paId);

      const callArgs = notificationsServiceMock.createNotification.mock.calls[0][0];
      expect(callArgs.recipientUserIds).not.toContain(paId);
    });

    it('9. A Team Lead creates a lead -> the responsible Manager receives notification and creator TL is excluded', async () => {
      prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === teamLeadId) {
          return Promise.resolve({
            id: teamLeadId,
            firstName: 'Rohan',
            lastName: 'TL',
            roleId: 4,
            role: { name: 'Team Lead' },
            teamId: 10,
            managerId,
            team: { id: 10, name: 'MBA Alpha Team', managerId },
          });
        }
        return Promise.resolve(null);
      });

      await service.create(baseDto, teamLeadId);

      expect(notificationsServiceMock.createNotification).toHaveBeenCalled();
      const callArgs = notificationsServiceMock.createNotification.mock.calls[0][0];
      expect(callArgs.recipientUserIds).toContain(managerId);
      expect(callArgs.recipientUserIds).not.toContain(teamLeadId);
      expect(callArgs.message).toContain('Team Lead: Rohan TL');
    });

    it('10. Manager creates a lead -> does not trigger notification for self or other managers', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: managerId,
        firstName: 'Manager',
        lastName: 'One',
        roleId: 3,
        role: { name: 'Manager' },
      });

      await service.create(baseDto, managerId);

      expect(notificationsServiceMock.createNotification).not.toHaveBeenCalled();
    });
  });
});
