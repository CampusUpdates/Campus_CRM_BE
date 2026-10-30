import { Test, TestingModule } from '@nestjs/testing';
import { BroadcastService } from './broadcast.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('BroadcastService - Acknowledgement & Manager Broadcast Scoping', () => {
  let service: BroadcastService;
  let prisma: any;
  let notificationsService: any;

  beforeEach(async () => {
    prisma = {
      broadcastRecipient: {
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        createMany: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      broadcastMessage: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      team: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      role: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    notificationsService = {
      createNotification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<BroadcastService>(BroadcastService);
  });

  describe('Acknowledgement Workflow', () => {
    it('should acknowledge broadcast for targeted recipient and persist timestamp', async () => {
      const mockRecipient = {
        id: 'rec-1',
        broadcastId: 'bc-1',
        userId: 'user-1',
        readAt: null,
        acknowledgedAt: null,
      };

      prisma.broadcastRecipient.findUnique.mockResolvedValue(mockRecipient);
      prisma.broadcastRecipient.update.mockResolvedValue({
        ...mockRecipient,
        readAt: new Date(),
        acknowledgedAt: new Date(),
      });

      const result = await service.acknowledge('bc-1', 'user-1');

      expect(prisma.broadcastRecipient.findUnique).toHaveBeenCalledWith({
        where: {
          broadcastId_userId: {
            broadcastId: 'bc-1',
            userId: 'user-1',
          },
        },
      });
      expect(prisma.broadcastRecipient.update).toHaveBeenCalled();
      expect(result.acknowledgedAt).toBeDefined();
    });

    it('should reject acknowledgement if user is not a recipient of the broadcast', async () => {
      prisma.broadcastRecipient.findUnique.mockResolvedValue(null);

      await expect(service.acknowledge('bc-99', 'user-unauthorized')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should be idempotent if broadcast is already acknowledged', async () => {
      const originalAckDate = new Date('2026-10-18T10:00:00Z');
      const mockRecipient = {
        id: 'rec-1',
        broadcastId: 'bc-1',
        userId: 'user-1',
        readAt: originalAckDate,
        acknowledgedAt: originalAckDate,
      };

      prisma.broadcastRecipient.findUnique.mockResolvedValue(mockRecipient);

      const result = await service.acknowledge('bc-1', 'user-1');

      expect(prisma.broadcastRecipient.update).not.toHaveBeenCalled();
      expect(result.acknowledgedAt).toBe(originalAckDate);
    });
  });

  describe('Manager Broadcast Scoping & Recipient Validation', () => {
    it('should allow Manager to target their managed teams and subordinates', async () => {
      const managerId = 'mgr-1';
      // Manager manages team 10
      prisma.team.findMany.mockResolvedValue([{ id: 10 }]);
      prisma.user.findUnique.mockResolvedValue({ teamId: 10 });
      // Allowed subordinates under team 10
      prisma.user.findMany.mockImplementation((args: any) => {
        if (args?.select?.id) {
          return Promise.resolve([{ id: 'sub-1' }, { id: 'sub-2' }]);
        }
        // Returned resolved users
        return Promise.resolve([
          {
            id: 'sub-1',
            firstName: 'Alice',
            lastName: 'Advisor',
            email: 'alice@crm.local',
            phone: '1234567890',
            roleId: 2,
            teamId: 10,
            role: { id: 2, name: 'PROGRAM_ADVISOR' },
            team: { id: 10, name: 'Admissions Team' },
          },
          {
            id: 'sub-2',
            firstName: 'Bob',
            lastName: 'Lead',
            email: 'bob@crm.local',
            phone: '1234567891',
            roleId: 5,
            teamId: 10,
            role: { id: 5, name: 'TEAM_LEAD' },
            team: { id: 10, name: 'Admissions Team' },
          },
        ]);
      });

      const preview = await service.previewRecipients(
        { targetAll: true },
        managerId,
      );

      expect(preview.count).toBe(2);
      expect(preview.recipients.map((r) => r.id)).toEqual(['sub-1', 'sub-2']);
    });

    it('should reject Manager targeting teams outside their managed scope', async () => {
      const managerId = 'mgr-1';
      prisma.team.findMany.mockResolvedValue([{ id: 10 }]);
      prisma.user.findUnique.mockResolvedValue({ teamId: 10 });
      prisma.user.findMany.mockResolvedValue([{ id: 'sub-1' }]);

      // Manager attempts to target team 99 which they do not manage
      await expect(
        service.previewRecipients(
          { targetAll: false, targetTeams: [99] },
          managerId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject Manager targeting employees outside their authorized scope', async () => {
      const managerId = 'mgr-1';
      prisma.team.findMany.mockResolvedValue([{ id: 10 }]);
      prisma.user.findUnique.mockResolvedValue({ teamId: 10 });
      prisma.user.findMany.mockResolvedValue([{ id: 'sub-1' }]);

      // Manager attempts to target unauthorized user 'intruder-user'
      await expect(
        service.previewRecipients(
          { targetAll: false, targetUserIds: ['intruder-user'] },
          managerId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Super Admin All Broadcasts vs Manager Broadcast Listing', () => {
    it('should return all broadcasts circulated across CRM for Super Admin', async () => {
      const mockBroadcasts = [
        {
          id: 'bc-admin',
          title: 'Campus Townhall',
          body: 'Quarterly update',
          status: 'SENT',
          createdAt: new Date(),
          sentAt: new Date(),
          createdById: 'admin-1',
          createdBy: {
            id: 'admin-1',
            firstName: 'Super',
            lastName: 'Admin',
            email: 'admin@crm.local',
            role: { id: 1, name: 'SUPER_ADMIN' },
          },
          targetAll: true,
          targetTeams: [],
          targetRoles: [],
          targetUserIds: [],
          _count: { recipients: 5 },
        },
        {
          id: 'bc-mgr',
          title: 'Team Briefing',
          body: 'Weekly targets',
          status: 'SENT',
          createdAt: new Date(),
          sentAt: new Date(),
          createdById: 'mgr-1',
          createdBy: {
            id: 'mgr-1',
            firstName: 'Manager',
            lastName: 'Dan',
            email: 'dan@crm.local',
            role: { id: 3, name: 'MANAGER' },
          },
          targetAll: false,
          targetTeams: [10],
          targetRoles: [],
          targetUserIds: [],
          _count: { recipients: 3 },
        },
      ];

      prisma.broadcastMessage.count.mockResolvedValue(2);
      prisma.broadcastMessage.findMany.mockResolvedValue(mockBroadcasts);
      prisma.broadcastRecipient.count.mockResolvedValue(5);
      prisma.team.findMany.mockResolvedValue([{ id: 10, name: 'Admissions' }]);
      prisma.role.findMany.mockResolvedValue([]);

      const result = await service.getBroadcasts(
        {},
        'admin-1',
        true, // isSuperAdmin
        false, // isManager
      );

      expect(result.data.length).toBe(2);
      expect(result.data[0].createdBy.role.name).toBe('SUPER_ADMIN');
      expect(result.data[1].createdBy.role.name).toBe('MANAGER');
      expect(result.data[1].targetAudience).toContain('Admissions');
    });

    it('should scope Manager broadcast listing to only broadcasts created by that Manager', async () => {
      const managerId = 'mgr-1';
      prisma.broadcastMessage.count.mockResolvedValue(1);
      prisma.broadcastMessage.findMany.mockImplementation((args: any) => {
        expect(args.where.createdById).toBe(managerId);
        return Promise.resolve([
          {
            id: 'bc-mgr',
            title: 'Team Briefing',
            body: 'Weekly targets',
            status: 'SENT',
            createdAt: new Date(),
            sentAt: new Date(),
            createdById: managerId,
            createdBy: {
              id: managerId,
              firstName: 'Dan',
              lastName: 'Manager',
              email: 'dan@crm.local',
              role: { id: 3, name: 'MANAGER' },
            },
            targetAll: false,
            targetTeams: [10],
            targetRoles: [],
            targetUserIds: [],
            _count: { recipients: 3 },
          },
        ]);
      });
      prisma.broadcastRecipient.count.mockResolvedValue(3);
      prisma.team.findMany.mockResolvedValue([{ id: 10, name: 'Admissions' }]);
      prisma.role.findMany.mockResolvedValue([]);

      const result = await service.getBroadcasts(
        {},
        managerId,
        false, // isSuperAdmin
        true, // isManager
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe('bc-mgr');
    });
  });

  describe('Recipient Tracking Report Access Control', () => {
    it('should allow Super Admin to access recipient tracking report for any broadcast', async () => {
      prisma.broadcastMessage.findUnique.mockResolvedValue({
        id: 'bc-1',
        title: 'Policy Update',
        body: 'Details here',
        createdAt: new Date(),
        sentAt: new Date(),
        createdById: 'mgr-99',
        createdBy: {
          id: 'mgr-99',
          firstName: 'Other',
          lastName: 'Manager',
          email: 'other@crm.local',
          role: { id: 3, name: 'MANAGER' },
        },
        targetAll: true,
      });
      prisma.broadcastRecipient.count.mockResolvedValue(1);
      prisma.broadcastRecipient.findMany.mockResolvedValue([]);
      prisma.team.findMany.mockResolvedValue([]);
      prisma.role.findMany.mockResolvedValue([]);

      const report = await service.getRecipientsReport(
        'bc-1',
        {},
        'admin-user',
        true, // isSuperAdmin
      );

      expect(report.broadcast.id).toBe('bc-1');
      expect(report.broadcast.createdBy.role.name).toBe('MANAGER');
    });

    it('should allow Manager to access tracking report for their own broadcast', async () => {
      const managerId = 'mgr-1';
      prisma.broadcastMessage.findUnique.mockResolvedValue({
        id: 'bc-1',
        title: 'Team Policy',
        body: 'Details',
        createdAt: new Date(),
        sentAt: new Date(),
        createdById: managerId,
        createdBy: {
          id: managerId,
          firstName: 'My',
          lastName: 'Manager',
          email: 'my@crm.local',
          role: { id: 3, name: 'MANAGER' },
        },
        targetAll: false,
        targetTeams: [10],
      });
      prisma.broadcastRecipient.count.mockResolvedValue(1);
      prisma.broadcastRecipient.findMany.mockResolvedValue([]);
      prisma.team.findMany.mockResolvedValue([{ id: 10, name: 'Admissions' }]);
      prisma.role.findMany.mockResolvedValue([]);

      const report = await service.getRecipientsReport(
        'bc-1',
        {},
        managerId,
        false, // isSuperAdmin = false
      );

      expect(report.broadcast.id).toBe('bc-1');
      expect(report.broadcast.targetAudience).toContain('Admissions');
    });

    it('should reject Manager attempting to access tracking report for a broadcast sent by someone else', async () => {
      const managerId = 'mgr-1';
      prisma.broadcastMessage.findUnique.mockResolvedValue({
        id: 'bc-other',
        title: 'Super Admin Secret',
        body: 'Details',
        createdAt: new Date(),
        sentAt: new Date(),
        createdById: 'super-admin-user',
        createdBy: {
          id: 'super-admin-user',
          firstName: 'Super',
          lastName: 'Admin',
          email: 'admin@crm.local',
        },
      });

      await expect(
        service.getRecipientsReport(
          'bc-other',
          {},
          managerId,
          false, // isSuperAdmin = false
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
