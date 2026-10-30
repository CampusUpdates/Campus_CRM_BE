import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CounsellingService } from './counselling.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TeamLeadAuthorizationService } from 'src/teams/team-lead-authorization.service';
import { LeadsService } from 'src/leads/leads.service';
import { NotificationsService } from 'src/notifications/notifications.service';

describe('CounsellingService', () => {
  let service: CounsellingService;
  let prisma: any;
  let teamLeadAuthService: any;
  let leadsService: any;
  let notificationsService: any;

  const mockLeadId = 'lead-uuid-1111';
  const mockCollegeId1 = 'college-uuid-1111';
  const mockCollegeId2 = 'college-uuid-2222';
  const mockPaId = 'pa-uuid-1111';
  const mockTlId = 'tl-uuid-1111';
  const mockManagerId = 'mgr-uuid-1111';
  const mockOtherUser = 'other-uuid-9999';

  beforeEach(async () => {
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({}),
    };

    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      lead: {
        findUnique: jest.fn(),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      college: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: 'col-1', name: 'Test College' }),
      },
      collegeCounsellingRequest: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    teamLeadAuthService = {
      isTeamLead: jest.fn().mockResolvedValue(false),
      getTeamLeadAdvisorIds: jest.fn().mockResolvedValue([]),
    };

    leadsService = {
      getManagerTeamMemberIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CounsellingService,
        { provide: PrismaService, useValue: prisma },
        { provide: TeamLeadAuthorizationService, useValue: teamLeadAuthService },
        { provide: LeadsService, useValue: leadsService },
        {
          provide: NotificationsService,
          useValue: notificationsService,
        },
      ],
    }).compile();

    service = module.get<CounsellingService>(CounsellingService);
  });

  describe('validateLeadAccess & Scoping', () => {
    it('1. Allows Program Advisor to access their own lead', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockPaId,
        role: { name: 'Program Advisor' },
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId }],
      });

      const lead = await service.validateLeadAccess(mockPaId, mockLeadId, 'READ');
      expect(lead).toBeDefined();
    });

    it('2. Denies cross-team access for unauthorized user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockOtherUser,
        role: { name: 'Program Advisor' },
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId }],
      });

      await expect(
        service.validateLeadAccess(mockOtherUser, mockLeadId, 'READ'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('3. Allows Team Lead to access leads belonging to supervised advisors', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockTlId,
        role: { name: 'Team Lead' },
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId }],
      });
      teamLeadAuthService.isTeamLead.mockResolvedValue(true);
      teamLeadAuthService.getTeamLeadAdvisorIds.mockResolvedValue([mockPaId]);

      const lead = await service.validateLeadAccess(mockTlId, mockLeadId, 'READ');
      expect(lead).toBeDefined();
    });

    it('4. Rejects Team Lead accessing leads outside supervised advisors', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockTlId,
        role: { name: 'Team Lead' },
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: 'unsupervised-pa',
        assignments: [{ userId: 'unsupervised-pa' }],
      });
      teamLeadAuthService.isTeamLead.mockResolvedValue(true);
      teamLeadAuthService.getTeamLeadAdvisorIds.mockResolvedValue(['supervised-pa-only']);

      await expect(
        service.validateLeadAccess(mockTlId, mockLeadId, 'READ'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('5. Hard blocks Program Advisors from marking counselling complete', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockPaId,
        role: { name: 'Program Advisor' },
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId }],
      });

      await expect(
        service.validateLeadAccess(mockPaId, mockLeadId, 'COMPLETE'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createCounsellingRequests', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockPaId,
        role: { name: 'Program Advisor' },
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId }],
      });
      prisma.college.findMany.mockResolvedValue([
        { id: mockCollegeId1, name: 'College 1', isActive: true },
        { id: mockCollegeId2, name: 'College 2', isActive: true },
      ]);
    });

    it('6. Creates independent counselling requests for multiple colleges without touching LeadCollege', async () => {
      prisma.collegeCounsellingRequest.create
        .mockResolvedValueOnce({
          id: 'req-1',
          leadId: mockLeadId,
          collegeId: mockCollegeId1,
          status: 'REQUESTED',
        })
        .mockResolvedValueOnce({
          id: 'req-2',
          leadId: mockLeadId,
          collegeId: mockCollegeId2,
          status: 'REQUESTED',
        });

      const res = await service.createCounsellingRequests(mockPaId, mockLeadId, {
        requests: [
          { collegeId: mockCollegeId1, preferredTiming: 'Morning', purpose: 'Course info' },
          { collegeId: mockCollegeId2, preferredTiming: 'Evening', purpose: 'Fee inquiry' },
        ],
      });

      expect(res).toHaveLength(2);
      expect(prisma.collegeCounsellingRequest.create).toHaveBeenCalledTimes(2);
    });

    it('6b. Correctly stores structured preferredDate and preferredTime independently for each college request', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId, status: 'ACTIVE' }],
      });
      prisma.college.findMany.mockResolvedValue([
        { id: mockCollegeId1, name: 'College A', isActive: true },
        { id: mockCollegeId2, name: 'College B', isActive: true },
      ]);
      prisma.collegeCounsellingRequest.create
        .mockResolvedValueOnce({
          id: 'req-1',
          leadId: mockLeadId,
          collegeId: mockCollegeId1,
          preferredDate: new Date('2026-10-30T00:00:00.000Z'),
          preferredTime: '10:30',
          status: 'REQUESTED',
        })
        .mockResolvedValueOnce({
          id: 'req-2',
          leadId: mockLeadId,
          collegeId: mockCollegeId2,
          preferredDate: new Date('2026-11-05T00:00:00.000Z'),
          preferredTime: '15:00',
          status: 'REQUESTED',
        });

      const res = await service.createCounsellingRequests(mockPaId, mockLeadId, {
        requests: [
          { collegeId: mockCollegeId1, preferredDate: '2026-10-30', preferredTime: '10:30', purpose: 'Campus tour' },
          { collegeId: mockCollegeId2, preferredDate: '2026-11-05', preferredTime: '15:00', purpose: 'Fee discount' },
        ],
      });

      expect(res).toHaveLength(2);
      expect(prisma.collegeCounsellingRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            collegeId: mockCollegeId1,
            preferredDate: new Date('2026-10-30T00:00:00.000Z'),
            preferredTime: '10:30',
            purpose: 'Campus tour',
          }),
        }),
      );
      expect(prisma.collegeCounsellingRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            collegeId: mockCollegeId2,
            preferredDate: new Date('2026-11-05T00:00:00.000Z'),
            preferredTime: '15:00',
            purpose: 'Fee discount',
          }),
        }),
      );
    });

    it('6c. Rejects past preferredDate with 400 Bad Request', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId, status: 'ACTIVE' }],
      });
      prisma.college.findMany.mockResolvedValue([
        { id: mockCollegeId1, name: 'College A', isActive: true },
      ]);

      await expect(
        service.createCounsellingRequests(mockPaId, mockLeadId, {
          requests: [
            { collegeId: mockCollegeId1, preferredDate: '2020-01-01', purpose: 'Past date check' },
          ],
        }),
      ).rejects.toThrow(new BadRequestException('Preferred counselling date cannot be in the past'));
    });

    it('6d. Accepts today local date and future dates without timezone rejection', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId, status: 'ACTIVE' }],
      });
      prisma.college.findMany.mockResolvedValue([
        { id: mockCollegeId1, name: 'College A', isActive: true },
      ]);
      prisma.collegeCounsellingRequest.create.mockResolvedValueOnce({
        id: 'req-today',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        preferredDate: new Date(),
        status: 'REQUESTED',
      });

      const now = new Date();
      const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      const res = await service.createCounsellingRequests(mockPaId, mockLeadId, {
        requests: [
          { collegeId: mockCollegeId1, preferredDate: localToday, purpose: 'Today date check' },
        ],
      });

      expect(res).toHaveLength(1);
    });

    it('7. Rejects duplicate active request with 409 Conflict', async () => {
      prisma.collegeCounsellingRequest.create.mockRejectedValueOnce({
        code: 'P2002',
        message: 'unique_active_lead_college_counselling',
      });

      await expect(
        service.createCounsellingRequests(mockPaId, mockLeadId, {
          requests: [{ collegeId: mockCollegeId1 }],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('completeCounsellingRequest', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockManagerId,
        role: { name: 'Manager' },
      });
      leadsService.getManagerTeamMemberIds.mockResolvedValue([mockPaId]);
      prisma.team.findMany.mockResolvedValue([{ id: 1 }]);
    });

    it('8. Rejects empty or whitespace completion remark with 400 Bad Request', async () => {
      await expect(
        service.completeCounsellingRequest(mockManagerId, 'req-1', { remark: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('8b. Rejects empty or whitespace revert property with 400 Bad Request', async () => {
      await expect(
        service.completeCounsellingRequest(mockManagerId, 'req-1', { revert: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('8c. Rejects duplicate completion on already completed request with 400 Bad Request', async () => {
      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        leadId: mockLeadId,
        status: 'COMPLETED',
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        teamId: 1,
        assignments: [{ userId: mockPaId }],
      });

      await expect(
        service.completeCounsellingRequest(mockManagerId, 'req-1', { revert: 'Done again' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('9. Successfully completes counselling with non-empty remark for authorized Manager and sends notification', async () => {
      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        status: 'REQUESTED',
        requestedById: mockPaId,
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        firstName: 'John',
        lastName: 'Doe',
        createdById: mockPaId,
        teamId: 1,
        assignments: [{ userId: mockPaId }],
      });
      prisma.college.findUnique.mockResolvedValue({
        id: mockCollegeId1,
        name: 'Oxford College',
      });
      prisma.user.findMany.mockResolvedValue([{ id: mockPaId }]);
      prisma.collegeCounsellingRequest.update.mockResolvedValue({
        id: 'req-1',
        status: 'COMPLETED',
        completionRemark: 'Counselling was successful.',
      });

      const res = await service.completeCounsellingRequest(mockManagerId, 'req-1', {
        remark: 'Counselling was successful.',
      });

      expect(res.status).toBe('COMPLETED');
      expect(prisma.collegeCounsellingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'COMPLETED',
            completionRemark: 'Counselling was successful.',
            completedById: mockManagerId,
          }),
        }),
      );
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Counselling Completed',
          recipientUserIds: [mockPaId],
          message: expect.stringContaining('Oxford College'),
        }),
      );
    });

    it('9b. Successfully completes counselling with revert property for authorized Manager', async () => {
      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        status: 'REQUESTED',
        requestedById: mockPaId,
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        firstName: 'Jane',
        lastName: 'Smith',
        createdById: mockPaId,
        teamId: 1,
        assignments: [{ userId: mockPaId }],
      });
      prisma.college.findUnique.mockResolvedValue({
        id: mockCollegeId1,
        name: 'Cambridge College',
      });
      prisma.user.findMany.mockResolvedValue([{ id: mockPaId }]);
      prisma.collegeCounsellingRequest.update.mockResolvedValue({
        id: 'req-1',
        status: 'COMPLETED',
        completionRemark: 'Instructions provided for admission test.',
      });

      const res = await service.completeCounsellingRequest(mockManagerId, 'req-1', {
        revert: 'Instructions provided for admission test.',
      });

      expect(res.status).toBe('COMPLETED');
      expect(prisma.collegeCounsellingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completionRemark: 'Instructions provided for admission test.',
          }),
        }),
      );
    });

    it('9b2. Successfully completes counselling with counsellingDate and revert for Manager', async () => {
      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-date',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        status: 'REQUESTED',
        requestedById: mockPaId,
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        firstName: 'Jane',
        lastName: 'Smith',
        createdById: mockPaId,
        teamId: 1,
        assignments: [{ userId: mockPaId }],
      });
      prisma.college.findUnique.mockResolvedValue({
        id: mockCollegeId1,
        name: 'Cambridge College',
      });
      prisma.user.findMany.mockResolvedValue([{ id: mockPaId }]);
      prisma.collegeCounsellingRequest.update.mockResolvedValue({
        id: 'req-date',
        status: 'COMPLETED',
        completionRemark: 'Counselling completed on site.',
        counsellingDate: new Date('2026-10-28T00:00:00.000Z'),
      });

      const res = await service.completeCounsellingRequest(mockManagerId, 'req-date', {
        revert: 'Counselling completed on site.',
        counsellingDate: '2026-10-28',
      });

      expect(res.status).toBe('COMPLETED');
      expect(prisma.collegeCounsellingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completionRemark: 'Counselling completed on site.',
            counsellingDate: new Date('2026-10-28T00:00:00.000Z'),
            status: 'COMPLETED',
          }),
        }),
      );
    });

    it('9c. Allows Team Lead to complete counselling for supervised advisor', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockTlId,
        role: { name: 'Team Lead' },
      });
      teamLeadAuthService.isTeamLead.mockResolvedValue(true);
      teamLeadAuthService.getTeamLeadAdvisorIds.mockResolvedValue([mockPaId]);

      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-tl',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        status: 'REQUESTED',
        requestedById: mockPaId,
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        firstName: 'Sam',
        createdById: mockPaId,
        assignments: [{ userId: mockPaId }],
      });
      prisma.college.findUnique.mockResolvedValue({
        id: mockCollegeId1,
        name: 'Stanford College',
      });
      prisma.user.findMany.mockResolvedValue([{ id: mockPaId }]);
      prisma.collegeCounsellingRequest.update.mockResolvedValue({
        id: 'req-tl',
        status: 'COMPLETED',
        completionRemark: 'TL reviewed and approved guidance.',
      });

      const res = await service.completeCounsellingRequest(mockTlId, 'req-tl', {
        revert: 'TL reviewed and approved guidance.',
      });

      expect(res.status).toBe('COMPLETED');
    });

    it('9d. Rejects Team Lead completing counselling outside supervised scope', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockTlId,
        role: { name: 'Team Lead' },
      });
      teamLeadAuthService.isTeamLead.mockResolvedValue(true);
      teamLeadAuthService.getTeamLeadAdvisorIds.mockResolvedValue(['other-pa']);

      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-unsupervised',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        status: 'REQUESTED',
        requestedById: mockPaId,
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId }],
      });

      await expect(
        service.completeCounsellingRequest(mockTlId, 'req-unsupervised', {
          revert: 'Attempted revert',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('9e. Hard blocks Program Advisor from completing counselling', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockPaId,
        role: { name: 'Program Advisor' },
      });
      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-pa',
        leadId: mockLeadId,
        status: 'REQUESTED',
      });
      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        createdById: mockPaId,
        assignments: [{ userId: mockPaId }],
      });

      await expect(
        service.completeCounsellingRequest(mockPaId, 'req-pa', {
          revert: 'PA trying to complete',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getPendingCounsellingRequests & Scoping', () => {
    it('10. Scopes pending requests for Manager to managed team members and managed teams', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockManagerId,
        role: { name: 'Manager' },
      });
      leadsService.getManagerTeamMemberIds.mockResolvedValue(['pa-1', 'pa-2']);
      prisma.team.findMany.mockResolvedValue([{ id: 10 }]);
      prisma.collegeCounsellingRequest.findMany.mockResolvedValue([
        { id: 'c-1', status: 'REQUESTED' },
      ]);

      const res = await service.getPendingCounsellingRequests(mockManagerId);
      expect(res).toHaveLength(1);
      expect(prisma.collegeCounsellingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'REQUESTED',
            OR: expect.arrayContaining([
              { requestedById: { in: [mockManagerId, 'pa-1', 'pa-2'] } },
            ]),
          }),
        }),
      );
    });

    it('11. Scopes pending requests for Team Lead to supervised advisors', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockTlId,
        role: { name: 'Team Lead' },
      });
      teamLeadAuthService.isTeamLead.mockResolvedValue(true);
      teamLeadAuthService.getTeamLeadAdvisorIds.mockResolvedValue(['pa-supervised']);
      prisma.collegeCounsellingRequest.findMany.mockResolvedValue([
        { id: 'c-2', status: 'REQUESTED' },
      ]);

      const res = await service.getPendingCounsellingRequests(mockTlId);
      expect(res).toHaveLength(1);
      expect(prisma.collegeCounsellingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'REQUESTED',
            OR: expect.arrayContaining([
              { requestedById: { in: [mockTlId, 'pa-supervised'] } },
            ]),
          }),
        }),
      );
    });

    it('12. Allows Super Admin global visibility without team scoping restrictions', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: { name: 'Super Admin' },
      });
      prisma.collegeCounsellingRequest.findMany.mockResolvedValue([
        { id: 'c-1', status: 'REQUESTED' },
        { id: 'c-2', status: 'REQUESTED' },
      ]);

      const res = await service.getPendingCounsellingRequests('admin-1');
      expect(res).toHaveLength(2);
      expect(prisma.collegeCounsellingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'REQUESTED' },
        }),
      );
    });

    it('13. Scopes Program Advisor to only their own leads and requests', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockPaId,
        role: { name: 'Program Advisor' },
      });
      teamLeadAuthService.isTeamLead.mockResolvedValue(false);
      prisma.collegeCounsellingRequest.findMany.mockResolvedValue([]);

      await service.getPendingCounsellingRequests(mockPaId);
      expect(prisma.collegeCounsellingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'REQUESTED',
            OR: [
              { requestedById: mockPaId },
              {
                lead: {
                  OR: [
                    { assignments: { some: { userId: mockPaId } } },
                    { createdById: mockPaId },
                  ],
                },
              },
            ],
          }),
        }),
      );
    });
  });

  describe('scheduleCounsellingRequest & Counselling Scheduled Flow', () => {
    it('14. Rejects scheduling without scheduledDate with 400 Bad Request', async () => {
      await expect(
        service.scheduleCounsellingRequest(mockManagerId, 'req-1', {
          scheduledDate: '',
          counsellingNotes: 'Discuss MBA specialization',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('15. Rejects scheduling without counsellingNotes with 400 Bad Request', async () => {
      await expect(
        service.scheduleCounsellingRequest(mockManagerId, 'req-1', {
          scheduledDate: '2026-11-01',
          counsellingNotes: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('16. Hard blocks Program Advisors from scheduling counselling', async () => {
      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        status: 'REQUESTED',
        requestedById: mockPaId,
      });

      prisma.user.findUnique.mockResolvedValue({
        id: mockPaId,
        role: { name: 'PROGRAM_ADVISOR' },
      });

      await expect(
        service.scheduleCounsellingRequest(mockPaId, 'req-1', {
          scheduledDate: '2026-11-01',
          scheduledTime: '14:30',
          counsellingNotes: 'PA trying to schedule',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('17. Successfully schedules counselling for authorized Manager, updates status to SCHEDULED, and sends notification', async () => {
      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        status: 'REQUESTED',
        requestedById: mockPaId,
      });

      // Manager user lookup
      prisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === mockManagerId) {
          return Promise.resolve({
            id: mockManagerId,
            role: { name: 'MANAGER' },
            firstName: 'Manager',
            lastName: 'User',
          });
        }
        return Promise.resolve(null);
      });

      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        firstName: 'Student',
        lastName: 'One',
        createdById: mockManagerId,
        assignments: [],
      });

      prisma.user.findFirst.mockResolvedValue({
        id: mockPaId,
        status: 'ACTIVE',
      });

      prisma.collegeCounsellingRequest.update.mockResolvedValue({
        id: 'req-1',
        status: 'SCHEDULED',
        scheduledDate: new Date('2026-11-01'),
        scheduledTime: '15:00',
        counsellingNotes: 'Session confirmed with dean',
        scheduledById: mockManagerId,
      });

      const result = await service.scheduleCounsellingRequest(mockManagerId, 'req-1', {
        scheduledDate: '2026-11-01',
        scheduledTime: '15:00',
        counsellingNotes: 'Session confirmed with dean',
      });

      expect(result.status).toBe('SCHEDULED');
      expect(prisma.collegeCounsellingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1' },
          data: expect.objectContaining({
            status: 'SCHEDULED',
            scheduledTime: '15:00',
            counsellingNotes: 'Session confirmed with dean',
            scheduledById: mockManagerId,
          }),
        }),
      );
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Counselling Scheduled',
          recipientUserIds: [mockPaId],
        }),
      );
    });

    it('18. Rejects scheduling an already COMPLETED request with 400 Bad Request', async () => {
      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-completed',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        status: 'COMPLETED',
        requestedById: mockPaId,
      });

      prisma.user.findUnique.mockResolvedValue({
        id: mockManagerId,
        role: { name: 'MANAGER' },
      });

      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        firstName: 'Student',
        createdById: mockManagerId,
        assignments: [],
      });

      await expect(
        service.scheduleCounsellingRequest(mockManagerId, 'req-completed', {
          scheduledDate: '2026-11-02',
          counsellingNotes: 'Try rescheduling completed',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('19. Allows completing a request from SCHEDULED status to COMPLETED', async () => {
      prisma.collegeCounsellingRequest.findUnique.mockResolvedValue({
        id: 'req-sched',
        leadId: mockLeadId,
        collegeId: mockCollegeId1,
        status: 'SCHEDULED',
        requestedById: mockPaId,
        scheduledDate: new Date('2026-11-01'),
      });

      prisma.user.findUnique.mockResolvedValue({
        id: mockManagerId,
        role: { name: 'MANAGER' },
      });

      prisma.lead.findUnique.mockResolvedValue({
        id: mockLeadId,
        firstName: 'Student',
        createdById: mockManagerId,
        assignments: [],
      });

      prisma.collegeCounsellingRequest.update.mockResolvedValue({
        id: 'req-sched',
        status: 'COMPLETED',
        completionRemark: 'Counselling finished successfully',
        completedById: mockManagerId,
      });

      const result = await service.completeCounsellingRequest(mockManagerId, 'req-sched', {
        remark: 'Counselling finished successfully',
      });

      expect(result.status).toBe('COMPLETED');
      expect(prisma.collegeCounsellingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-sched' },
          data: expect.objectContaining({
            status: 'COMPLETED',
            completionRemark: 'Counselling finished successfully',
          }),
        }),
      );
    });

    it('20. Filters by SCHEDULED status in getAllCounsellingRequests', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockManagerId,
        role: { name: 'SUPER_ADMIN' },
      });

      prisma.collegeCounsellingRequest.findMany.mockResolvedValue([]);

      await service.getAllCounsellingRequests(mockManagerId, 'SCHEDULED');

      expect(prisma.collegeCounsellingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'SCHEDULED',
          }),
        }),
      );
    });

    it('21. Filters by date range (today, last_7_days, custom) in getAllCounsellingRequests', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockManagerId,
        role: { name: 'SUPER_ADMIN' },
      });
      prisma.collegeCounsellingRequest.findMany.mockResolvedValue([]);

      await service.getAllCounsellingRequests(mockManagerId, { time: 'today' });
      expect(prisma.collegeCounsellingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            requestedAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );

      await service.getAllCounsellingRequests(mockManagerId, {
        time: 'custom',
        fromDate: '2026-10-01',
        toDate: '2026-10-15',
      });
      expect(prisma.collegeCounsellingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            requestedAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });

    it('22. Returns paginated response with data, total, page, limit, and totalPages', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockManagerId,
        role: { name: 'SUPER_ADMIN' },
      });
      const mockItems = [{ id: 'req-1', status: 'REQUESTED' }];
      prisma.collegeCounsellingRequest.findMany.mockResolvedValue(mockItems);
      prisma.collegeCounsellingRequest.count.mockResolvedValue(25);

      const res: any = await service.getAllCounsellingRequests(mockManagerId, {
        page: 2,
        limit: 10,
      });

      expect(res).toEqual({
        data: mockItems,
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
      expect(prisma.collegeCounsellingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });

    it('23. Correctly combines status filter, date range, and pagination', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockManagerId,
        role: { name: 'SUPER_ADMIN' },
      });
      prisma.collegeCounsellingRequest.findMany.mockResolvedValue([]);
      prisma.collegeCounsellingRequest.count.mockResolvedValue(5);

      const res: any = await service.getAllCounsellingRequests(mockManagerId, {
        status: 'COMPLETED',
        time: 'this_month',
        page: 1,
        limit: 25,
      });

      expect(res).toEqual({
        data: [],
        total: 5,
        page: 1,
        limit: 25,
        totalPages: 1,
      });
      expect(prisma.collegeCounsellingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 25,
          where: expect.objectContaining({
            status: 'COMPLETED',
            requestedAt: expect.any(Object),
          }),
        }),
      );
    });
  });
});
