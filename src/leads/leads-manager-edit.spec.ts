import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import { EmailService } from '../email/email.service';
import { ForbiddenException } from '@nestjs/common';

describe('LeadsService - Manager Edit & Status Change Permissions', () => {
  let service: LeadsService;
  let prismaMock: any;
  let teamLeadAuthMock: any;

  const managerId = '11111111-1111-1111-1111-111111111111';
  const teamMemberId = '22222222-2222-2222-2222-222222222222';
  const outsiderId = '33333333-3333-3333-3333-333333333333';
  const leadId = '44444444-4444-4444-4444-444444444444';
  const teamId = 10;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn().mockImplementation((cb) => cb(prismaMock)),
      lead: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: leadId, firstName: 'Updated' }),
      },
      leadAssignment: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      leadCollege: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      leadCollegeHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
      leadStatus: {
        findUnique: jest.fn().mockResolvedValue({
          id: 2,
          name: 'APPLICATION',
          displayOrder: 2,
          isActive: true,
        }),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([{ id: teamId }]),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ id: teamMemberId }]),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
      interaction: {
        create: jest.fn().mockResolvedValue({ id: 'int-1' }),
      },
    };

    teamLeadAuthMock = {
      isTeamLead: jest.fn().mockResolvedValue(false),
      canTeamLeadAccessLead: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: TeamLeadAuthorizationService, useValue: teamLeadAuthMock },
        { provide: EmailService, useValue: { sendLeadCreationNotificationToManager: jest.fn() } },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
  });

  describe('update (edit lead details)', () => {
    it('1. should allow a Manager to edit a lead posted by their team member', async () => {
      // Lead created by teamMemberId
      prismaMock.lead.findUnique.mockResolvedValue({
        id: leadId,
        createdById: teamMemberId,
        teamId,
        createdBy: { id: teamMemberId, teamId, managerId },
        assignments: [],
      });

      // User is Manager
      prismaMock.user.findUnique.mockResolvedValue({
        id: managerId,
        role: { name: 'Manager' },
        teamId: null,
      });

      const result = await service.update(
        leadId,
        { firstName: 'NewName' },
        { sub: managerId },
        'TEAM',
      );

      expect(result).toBeDefined();
      expect(prismaMock.lead.update).toHaveBeenCalled();
    });

    it('2. should reject a non-manager from another team trying to edit a lead', async () => {
      prismaMock.lead.findUnique.mockResolvedValue({
        id: leadId,
        createdById: teamMemberId,
        teamId,
        createdBy: { id: teamMemberId, teamId, managerId },
        assignments: [],
      });

      // Outsider advisor
      prismaMock.user.findUnique.mockResolvedValue({
        id: outsiderId,
        role: { name: 'Program Advisor' },
        teamId: 999,
      });
      prismaMock.team.findMany.mockResolvedValue([]);
      prismaMock.user.findMany.mockResolvedValue([]);

      await expect(
        service.update(
          leadId,
          { firstName: 'Hacked' },
          { sub: outsiderId, teamId: 999 },
          'OWN',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('3. should allow Manager to edit even if lead assignment expired', async () => {
      const pastDate = new Date(Date.now() - 100000);
      prismaMock.lead.findUnique.mockResolvedValue({
        id: leadId,
        createdById: teamMemberId,
        teamId,
        createdBy: { id: teamMemberId, teamId, managerId },
        assignments: [],
      });

      prismaMock.leadAssignment.findFirst.mockResolvedValue({
        id: 'old-assign',
        status: 'EXPIRED',
        expiresAt: pastDate,
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: managerId,
        role: { name: 'Manager' },
      });

      const result = await service.update(
        leadId,
        { firstName: 'ManagerEditAfterExpiry' },
        { sub: managerId },
        'TEAM',
      );

      expect(result).toBeDefined();
    });
  });

  describe('updatePipeline (change status)', () => {
    it('4. should allow a Manager to change status of a lead posted by their team member', async () => {
      const collegeId = '55555555-5555-5555-5555-555555555555';
      prismaMock.lead.findUnique.mockResolvedValue({
        id: leadId,
        createdById: teamMemberId,
        teamId,
        createdBy: { id: teamMemberId, teamId, managerId },
        assignments: [],
        collegeApplications: [],
      });

      prismaMock.leadStatus.findUnique.mockResolvedValue({
        id: 6,
        name: 'CANCELLED',
        displayOrder: 6,
        isActive: true,
      });

      prismaMock.college = {
        findUnique: jest.fn().mockResolvedValue({ id: collegeId }),
      };

      prismaMock.leadCollege.findFirst = jest.fn().mockResolvedValue({
        id: 'app-1',
        leadId,
        collegeId,
        approvalStatus: 'APPROVED',
        college: { name: 'Test College' },
      });

      prismaMock.leadCollege.update = jest.fn().mockResolvedValue({
        id: 'app-1',
        leadId,
        collegeId,
        college: { name: 'Test College' },
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: managerId,
        role: { name: 'Manager' },
      });

      const result = await service.updatePipeline(
        leadId,
        {
          statusId: 6,
          collegeId,
          cancellation: { reason: 'Not interested' },
        },
        { sub: managerId },
        'TEAM',
      );

      expect(result).toBeDefined();
      expect(prismaMock.leadCollege.update).toHaveBeenCalled();
    });
  });
});
