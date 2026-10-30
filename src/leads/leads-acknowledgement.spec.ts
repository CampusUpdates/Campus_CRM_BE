import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

describe('LeadsService - Lead Acknowledgement Workflow', () => {
  let service: LeadsService;
  let prisma: any;
  let teamLeadAuthService: any;

  const validLeadId = '11111111-1111-1111-1111-111111111111';
  const advisorUserId = '22222222-2222-2222-2222-222222222222';
  const managerUserId = '33333333-3333-3333-3333-333333333333';
  const otherManagerId = '44444444-4444-4444-4444-444444444444';
  const teamLeadUserId = '55555555-5555-5555-5555-555555555555';
  const superAdminUserId = '66666666-6666-6666-6666-666666666666';
  const collegeId = '77777777-7777-7777-7777-777777777777';

  const mockPrismaService = {
    lead: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    team: {
      findMany: jest.fn(),
    },
    leadAcknowledgement: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
    },
  };

  const mockNotificationsService = {
    createNotification: jest.fn(),
  };

  const mockTeamLeadAuthService = {
    isTeamLead: jest.fn(),
    canTeamLeadAccessLead: jest.fn(),
    getTeamLeadAdvisorIds: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockTeamLeadAuthService.isTeamLead.mockResolvedValue(false);
    mockTeamLeadAuthService.canTeamLeadAccessLead.mockResolvedValue(true);
    mockTeamLeadAuthService.getTeamLeadAdvisorIds.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: TeamLeadAuthorizationService, useValue: mockTeamLeadAuthService },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
    prisma = module.get<PrismaService>(PrismaService);
    teamLeadAuthService = module.get<TeamLeadAuthorizationService>(TeamLeadAuthorizationService);
  });

  describe('acknowledgeLead permissions & scoping', () => {
    it('1. should throw NotFoundException if lead does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: managerUserId,
        role: { name: 'Manager' },
      });
      prisma.lead.findUnique.mockResolvedValue(null);

      await expect(
        service.acknowledgeLead(validLeadId, managerUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('2. should throw ForbiddenException if Program Advisor tries to acknowledge', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: advisorUserId,
        role: { name: 'Program Advisor' },
      });

      await expect(
        service.acknowledgeLead(validLeadId, advisorUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('3. should throw ForbiddenException if Manager is outside of lead team scope', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: otherManagerId,
        role: { name: 'Manager' },
      });

      prisma.lead.findUnique.mockResolvedValue({
        id: validLeadId,
        createdById: 'someone-else',
        teamId: 'other-team',
        createdBy: { id: 'someone-else', teamId: 'other-team', managerId: 'different-mgr' },
        assignments: [
          {
            userId: advisorUserId,
            status: 'ACTIVE',
            user: { id: advisorUserId, teamId: 'other-team', managerId: 'different-mgr' },
          },
        ],
      });

      // Manager has no teams matching other-team
      prisma.team.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.acknowledgeLead(validLeadId, otherManagerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('4. should successfully acknowledge when Manager is authorized for the lead', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: managerUserId,
        role: { name: 'Manager' },
      });

      prisma.lead.findUnique.mockResolvedValue({
        id: validLeadId,
        createdById: advisorUserId,
        assignments: [
          {
            userId: advisorUserId,
            status: 'ACTIVE',
            user: { id: advisorUserId, teamId: 'mgr-team', managerId: managerUserId },
          },
        ],
      });

      prisma.team.findMany.mockResolvedValue([{ id: 'mgr-team' }]);
      prisma.user.findMany.mockResolvedValue([{ id: advisorUserId }]); // team members

      const pendingShare = {
        id: 'share-101',
        leadId: validLeadId,
        collegeId: collegeId,
        status: 'PENDING',
        acknowledgedAt: null,
      };

      prisma.leadAcknowledgement.findFirst.mockResolvedValue(pendingShare);
      prisma.leadAcknowledgement.update.mockResolvedValue({
        ...pendingShare,
        acknowledgedById: managerUserId,
        acknowledgedAt: new Date(),
        status: 'ACKNOWLEDGED',
      });
      prisma.activityLog.create.mockResolvedValue({});

      const result = await service.acknowledgeLead(validLeadId, managerUserId);

      expect(result.message).toBe('Lead posting acknowledged successfully');
      expect(prisma.leadAcknowledgement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'share-101' },
          data: expect.objectContaining({
            acknowledgedById: managerUserId,
            status: 'ACKNOWLEDGED',
          }),
        }),
      );
    });

    it('5. should throw ForbiddenException if Team Lead is not supervising the lead assigned/creator advisor', async () => {
      mockTeamLeadAuthService.isTeamLead.mockResolvedValue(true);
      mockTeamLeadAuthService.getTeamLeadAdvisorIds.mockResolvedValue(['some-other-advisor']);

      prisma.user.findUnique.mockResolvedValue({
        id: teamLeadUserId,
        role: { name: 'Team Lead' },
      });

      prisma.lead.findUnique.mockResolvedValue({
        id: validLeadId,
        createdById: advisorUserId,
        assignments: [
          {
            userId: advisorUserId,
            status: 'ACTIVE',
            user: { id: advisorUserId },
          },
        ],
      });

      await expect(
        service.acknowledgeLead(validLeadId, teamLeadUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('6. should allow Team Lead to acknowledge when supervising the assigned advisor', async () => {
      mockTeamLeadAuthService.isTeamLead.mockResolvedValue(true);
      mockTeamLeadAuthService.getTeamLeadAdvisorIds.mockResolvedValue([advisorUserId]);

      prisma.user.findUnique.mockResolvedValue({
        id: teamLeadUserId,
        role: { name: 'Team Lead' },
      });

      prisma.lead.findUnique.mockResolvedValue({
        id: validLeadId,
        createdById: advisorUserId,
        assignments: [
          {
            userId: advisorUserId,
            status: 'ACTIVE',
            user: { id: advisorUserId },
          },
        ],
      });

      const pendingShare = {
        id: 'share-202',
        leadId: validLeadId,
        collegeId: collegeId,
        status: 'PENDING',
      };

      prisma.leadAcknowledgement.findFirst.mockResolvedValue(pendingShare);
      prisma.leadAcknowledgement.update.mockResolvedValue({
        ...pendingShare,
        acknowledgedById: teamLeadUserId,
        acknowledgedAt: new Date(),
        status: 'ACKNOWLEDGED',
      });
      prisma.activityLog.create.mockResolvedValue({});

      const result = await service.acknowledgeLead(validLeadId, teamLeadUserId);

      expect(result.message).toBe('Lead posting acknowledged successfully');
      expect(prisma.leadAcknowledgement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'share-202' },
          data: expect.objectContaining({
            acknowledgedById: teamLeadUserId,
            status: 'ACKNOWLEDGED',
          }),
        }),
      );
    });

    it('7. should allow Super Admin to acknowledge any lead', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: superAdminUserId,
        role: { name: 'Super Admin' },
      });

      prisma.lead.findUnique.mockResolvedValue({
        id: validLeadId,
        createdById: 'someone',
        assignments: [],
      });

      const pendingShare = {
        id: 'share-303',
        leadId: validLeadId,
        status: 'PENDING',
        acknowledgedAt: null,
      };

      prisma.leadAcknowledgement.findUnique.mockResolvedValue(pendingShare);
      prisma.leadAcknowledgement.update.mockResolvedValue({
        ...pendingShare,
        acknowledgedById: superAdminUserId,
        acknowledgedAt: new Date(),
        status: 'ACKNOWLEDGED',
      });
      prisma.activityLog.create.mockResolvedValue({});

      const result = await service.acknowledgeLead(validLeadId, superAdminUserId, 'share-303');
      expect(result.message).toBe('Lead posting acknowledged successfully');
    });
  });

  describe('College-specific & repeatable posting workflow', () => {
    it('8. should create a separate pending share with collegeId and status PENDING', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: validLeadId,
        assignments: [{ userId: advisorUserId, status: 'ACTIVE' }],
      });

      const mockShare = {
        id: 'share-new',
        leadId: validLeadId,
        collegeId: collegeId,
        recipientId: advisorUserId,
        sharedById: managerUserId,
        status: 'PENDING',
        channel: 'WHATSAPP',
        context: 'Posted for College A',
      };

      prisma.leadAcknowledgement.create.mockResolvedValue(mockShare);

      const result = await service.shareLead(
        validLeadId,
        managerUserId,
        'WHATSAPP',
        'Posted for College A',
        advisorUserId,
        collegeId,
      );

      expect(result.message).toBe('Lead share recorded successfully');
      expect(prisma.leadAcknowledgement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: validLeadId,
            collegeId: collegeId,
            status: 'PENDING',
          }),
        }),
      );
      // Ensure acknowledgedAt is null on creation
      const createData = prisma.leadAcknowledgement.create.mock.calls[0][0].data;
      expect(createData.acknowledgedAt).toBeNull();
    });

    it('9. should return all posting history with college details ordered by newest first', async () => {
      const shares = [
        {
          id: 'share-2',
          leadId: validLeadId,
          collegeId: collegeId,
          college: { id: collegeId, name: 'College A' },
          status: 'PENDING',
          createdAt: new Date('2026-10-26T12:00:00Z'),
        },
        {
          id: 'share-1',
          leadId: validLeadId,
          collegeId: collegeId,
          college: { id: collegeId, name: 'College A' },
          status: 'ACKNOWLEDGED',
          createdAt: new Date('2026-10-25T10:00:00Z'),
        },
      ];

      prisma.leadAcknowledgement.findMany.mockResolvedValue(shares);

      const history = await service.getLeadShares(validLeadId);
      expect(history.length).toBe(2);
      expect(history[0].status).toBe('PENDING');
      expect(history[1].status).toBe('ACKNOWLEDGED');
      expect(prisma.leadAcknowledgement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { leadId: validLeadId },
          orderBy: { createdAt: 'desc' },
          include: expect.objectContaining({
            college: { select: { id: true, name: true } },
          }),
        }),
      );
    });
  });
});
