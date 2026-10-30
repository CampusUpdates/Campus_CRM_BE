import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('LeadsService - Lead Allocation and Reallocation Notifications', () => {
  let service: LeadsService;
  let notificationsServiceMock: any;
  let prismaMock: any;
  let teamLeadAuthServiceMock: any;

  const leadId1 = 'lead-uuid-1111-1111-1111-111111111111';
  const leadId2 = 'lead-uuid-2222-2222-2222-222222222222';
  const previousPaId = 'pa-prev-1111-1111-1111-111111111111';
  const newPaId = 'pa-new-2222-2222-2222-222222222222';
  const managerId = 'mgr-user-3333-3333-3333-333333333333';
  const superAdminId = 'sa-user-4444-4444-4444-444444444444';

  const mockNewLead = {
    id: leadId1,
    firstName: 'Rahul',
    lastName: 'Verma',
    statusId: 1,
    status: { id: 1, name: 'LEAD', isSystem: true },
    createdById: managerId,
    assignments: [],
    leadColleges: [],
    pipelineStageHistories: [],
  };

  const expiredDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const mockExpiredLead = {
    id: leadId2,
    firstName: 'Ananya',
    lastName: 'Sen',
    statusId: 1,
    status: { id: 1, name: 'LEAD', isSystem: true },
    createdById: previousPaId,
    assignments: [
      {
        id: 101,
        leadId: leadId2,
        userId: previousPaId,
        status: 'EXPIRED',
        assignedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        expiresAt: expiredDate,
      },
    ],
    leadColleges: [],
    pipelineStageHistories: [],
  };

  beforeEach(async () => {
    notificationsServiceMock = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-uuid-1' }),
    };

    teamLeadAuthServiceMock = {
      isTeamLead: jest.fn().mockResolvedValue(false),
      getTeamLeadAdvisorIds: jest.fn().mockResolvedValue([]),
      getTeamLeadAssignedTeamIds: jest.fn().mockResolvedValue([]),
      canTeamLeadAccessTeam: jest.fn().mockResolvedValue(true),
      canTeamLeadAccessAdvisor: jest.fn().mockResolvedValue(true),
      canTeamLeadAccessLead: jest.fn().mockResolvedValue(true),
    };

    prismaMock = {
      lead: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === leadId1) return Promise.resolve({ ...mockNewLead });
          if (where.id === leadId2) return Promise.resolve({ ...mockExpiredLead });
          if (where.id?.startsWith?.('bulk-lead-')) {
            return Promise.resolve({
              ...mockNewLead,
              id: where.id,
              firstName: 'Student',
              lastName: where.id,
            });
          }
          return Promise.resolve({ ...mockNewLead, id: where.id });
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      leadAssignment: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 999, ...data }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      leadOwnershipHistory: {
        create: jest.fn().mockResolvedValue({ id: 'hist-1' }),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({ id: 'act-1' }),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === newPaId) {
            return Promise.resolve({
              id: newPaId,
              firstName: 'Priya',
              lastName: 'Nair',
              status: 'ACTIVE',
              role: { name: 'PROGRAM_ADVISOR' },
            });
          }
          if (where.id === managerId) {
            return Promise.resolve({
              id: managerId,
              firstName: 'Vikram',
              lastName: 'Malhotra',
              status: 'ACTIVE',
              role: { name: 'MANAGER' },
            });
          }
          if (where.id === superAdminId) {
            return Promise.resolve({
              id: superAdminId,
              firstName: 'Rajesh',
              lastName: 'Koothrappali',
              status: 'ACTIVE',
              role: { name: 'SUPER_ADMIN' },
            });
          }
          return Promise.resolve(null);
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: leadId1 }]),
      $transaction: jest.fn().mockImplementation((cb) => cb(prismaMock)),
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

  describe('First-Time Lead Assignment', () => {
    it('1. Triggers "New Lead Assigned" notification to the persisted new assignee', async () => {
      const res = await service.assignLead(leadId1, newPaId, { sub: managerId });

      expect(res).toBeDefined();
      expect(res.assignment.userId).toBe(newPaId);

      // Verify notification sent
      expect(notificationsServiceMock.createNotification).toHaveBeenCalledTimes(1);
      const notifPayload = notificationsServiceMock.createNotification.mock.calls[0][0];

      // Recipient must strictly be the new owner
      expect(notifPayload.recipientUserIds).toEqual([newPaId]);
      expect(notifPayload.title).toBe('New Lead Assigned');
      expect(notifPayload.type).toBe('LEAD');

      // Content verification
      expect(notifPayload.message).toContain('Vikram Malhotra assigned a new lead to you.');
      expect(notifPayload.message).toContain('Student: Rahul Verma');
      expect(notifPayload.message).toContain(`Lead ID: ${leadId1}`);
      expect(notifPayload.message).toContain('Assigned By: Vikram Malhotra');
      expect(notifPayload.message).toContain(`Link: /leads/${leadId1}`);
      expect(notifPayload.message).toContain(`Lead Details: /leads/${leadId1}`);
    });
  });

  describe('Lead Reallocation to Another PA', () => {
    it('2. Triggers "Lead Reallocated to You" notification to the new PA and excludes previous owner/manager', async () => {
      const res = await service.assignLead(leadId2, newPaId, { sub: managerId });

      expect(res).toBeDefined();
      expect(res.assignment.userId).toBe(newPaId);

      expect(notificationsServiceMock.createNotification).toHaveBeenCalledTimes(1);
      const notifPayload = notificationsServiceMock.createNotification.mock.calls[0][0];

      // Only the new PA receives the notification
      expect(notifPayload.recipientUserIds).toEqual([newPaId]);
      expect(notifPayload.recipientUserIds).not.toContain(previousPaId);
      expect(notifPayload.recipientUserIds).not.toContain(managerId);

      expect(notifPayload.title).toBe('Lead Reallocated to You');
      expect(notifPayload.type).toBe('LEAD');
      expect(notifPayload.message).toContain('Vikram Malhotra reallocated a lead to you.');
      expect(notifPayload.message).toContain('Student: Ananya Sen');
      expect(notifPayload.message).toContain(`Lead ID: ${leadId2}`);
      expect(notifPayload.message).toContain(`Link: /leads/${leadId2}`);
    });
  });

  describe('Super Admin Reallocation Override', () => {
    it('3. Super Admin reallocates lead to an eligible PA or Manager with persistent notification', async () => {
      const res = await service.assignLead(leadId2, newPaId, { sub: superAdminId });

      expect(res).toBeDefined();
      expect(notificationsServiceMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Lead Reallocated to You',
          recipientUserIds: [newPaId],
          type: 'LEAD',
          message: expect.stringContaining('Rajesh Koothrappali reallocated a lead to you.'),
        }),
      );
    });
  });

  describe('Bulk Reallocation (bulkReallocateLeads)', () => {
    it('4. Reallocating multiple leads triggers notification per successfully persisted lead', async () => {
      const res = await service.bulkReallocateLeads(
        { leadIds: [leadId1, leadId2], targetUserId: newPaId },
        { sub: managerId },
      );

      expect(res.successCount).toBe(2);
      expect(res.failedCount).toBe(0);
      expect(notificationsServiceMock.createNotification).toHaveBeenCalledTimes(2);

      const firstCall = notificationsServiceMock.createNotification.mock.calls[0][0];
      const secondCall = notificationsServiceMock.createNotification.mock.calls[1][0];

      expect(firstCall.recipientUserIds).toEqual([newPaId]);
      expect(firstCall.title).toBe('New Lead Assigned');

      expect(secondCall.recipientUserIds).toEqual([newPaId]);
      expect(secondCall.title).toBe('Lead Reallocated to You');
    });

    it('5. Failed lead in bulk reallocation does not create an orphaned notification', async () => {
      // Mock leadId1 as having completed admission (ineligible)
      prismaMock.lead.findUnique.mockImplementation(({ where }) => {
        if (where.id === leadId1) {
          return Promise.resolve({
            ...mockNewLead,
            status: { id: 99, name: 'ADMISSION_DONE', isSystem: true },
          });
        }
        if (where.id === leadId2) {
          return Promise.resolve({ ...mockExpiredLead });
        }
        return Promise.resolve(null);
      });

      const res = await service.bulkReallocateLeads(
        { leadIds: [leadId1, leadId2], targetUserId: newPaId },
        { sub: managerId },
      );

      expect(res.successCount).toBe(1);
      expect(res.failedCount).toBe(1);
      expect(res.failedLeads[0].leadId).toBe(leadId1);

      // Only 1 notification generated (for leadId2)
      expect(notificationsServiceMock.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationsServiceMock.createNotification.mock.calls[0][0].message).toContain(
        `Lead ID: ${leadId2}`,
      );
    });
  });

  describe('Bulk Assignment (assignBulkLeads)', () => {
    it('6. assignBulkLeads with multiple leads sends bulk notification with lead count and link to /leads', async () => {
      prismaMock.lead.findMany.mockResolvedValue([
        { ...mockNewLead, id: 'bulk-lead-1' },
        { ...mockNewLead, id: 'bulk-lead-2' },
      ]);

      const res = await service.assignBulkLeads(
        { quantity: 2, targetUserId: newPaId },
        { sub: managerId },
      );

      expect(res.assignedCount).toBe(2);
      expect(notificationsServiceMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Lead Assigned',
          recipientUserIds: [newPaId],
          message: expect.stringContaining('Assigned Leads: 2 Leads'),
        }),
      );
      expect(notificationsServiceMock.createNotification.mock.calls[0][0].message).toContain(
        'Link: /leads',
      );
    });

    it('7. assignBulkLeads with a single lead includes the student name and lead identifier', async () => {
      prismaMock.lead.findMany.mockResolvedValue([
        { ...mockNewLead, id: leadId1, firstName: 'Aarav', lastName: 'Gupta' },
      ]);

      const res = await service.assignBulkLeads(
        { quantity: 1, targetUserId: newPaId },
        { sub: managerId },
      );

      expect(res.assignedCount).toBe(1);
      expect(notificationsServiceMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Lead Assigned',
          recipientUserIds: [newPaId],
          message: expect.stringContaining('Student: Aarav Gupta'),
        }),
      );
      expect(notificationsServiceMock.createNotification.mock.calls[0][0].message).toContain(
        `Lead ID: ${leadId1}`,
      );
      expect(notificationsServiceMock.createNotification.mock.calls[0][0].message).toContain(
        `Link: /leads/${leadId1}`,
      );
    });
  });

  describe('Failure and Rollback Protection', () => {
    it('8. Does not create notifications for an active lead inside 4-day window (rejected assignment)', async () => {
      const activeWindowLead = {
        ...mockNewLead,
        assignments: [
          {
            id: 202,
            userId: previousPaId,
            status: 'ACTIVE',
            assignedAt: new Date(),
            expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // active!
          },
        ],
      };
      prismaMock.lead.findUnique.mockResolvedValue(activeWindowLead);

      await expect(
        service.assignLead(leadId1, newPaId, { sub: managerId }),
      ).rejects.toThrow(ConflictException);

      expect(notificationsServiceMock.createNotification).not.toHaveBeenCalled();
    });

    it('9. If notification creation fails, assignment remains successfully committed', async () => {
      notificationsServiceMock.createNotification.mockRejectedValue(
        new Error('SSE connection failure'),
      );

      const res = await service.assignLead(leadId1, newPaId, { sub: managerId });

      // Transaction still completed and returned valid assignment
      expect(res).toBeDefined();
      expect(res.assignment.userId).toBe(newPaId);
      expect(res.message).toBe('Lead assigned successfully');
    });
  });
});
