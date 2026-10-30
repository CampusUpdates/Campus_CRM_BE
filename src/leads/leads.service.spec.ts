import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import { CollegeStatus, LeadSource } from '@prisma/client';

describe('LeadsService - College Pitch Approval Rules', () => {
  let service: LeadsService;
  let prismaMock: any;
  let teamLeadAuthService: any;

  const validLeadUuid = '11111111-1111-4111-8111-111111111111';
  const validUserUuid = '22222222-2222-4222-8222-222222222222';
  const validCollegeUuid1 = '33333333-3333-4333-8333-333333333333';
  const validCollegeUuid2 = '44444444-4444-4444-8444-444444444444';

  const mockUser = { sub: validUserUuid, role: 'PROGRAM_ADVISOR' };
  const mockLead = {
    id: validLeadUuid,
    statusId: 1,
    createdById: validUserUuid,
    firstName: 'John',
    lastName: 'Doe',
    phone: '9876543210',
    email: 'john@example.com',
    source: LeadSource.OTHER,
  };
  const mockStatus = { id: 1, name: 'LEAD', isActive: true };

  beforeEach(async () => {
    prismaMock = {
      leadStatus: {
        findFirst: jest.fn().mockResolvedValue(mockStatus),
        findUnique: jest.fn().mockResolvedValue(mockStatus),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(mockLead),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(mockLead),
        update: jest.fn().mockResolvedValue(mockLead),
      },
      college: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      leadCollege: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'pitch-1', ...data }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'pitch-1', ...data }),
          ),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      leadCollegeInterview: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'int-1' }),
        update: jest.fn().mockResolvedValue({ id: 'int-1' }),
      },
      leadCollegeHistory: {
        create: jest.fn().mockResolvedValue({ id: 'hist-1' }),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      leadAssignment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      leadOwnershipHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      },
      notificationRecipient: {
        create: jest.fn().mockResolvedValue({}),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      teamMember: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((cb) => cb(prismaMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
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

    service = module.get<LeadsService>(LeadsService);
    teamLeadAuthService = module.get<TeamLeadAuthorizationService>(
      TeamLeadAuthorizationService,
    );
  });

  const createDto = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '9876543210',
    city: 'Mumbai',
    state: 'Maharashtra',
    source: LeadSource.OTHER,
    collegeIds: [validCollegeUuid1],
  };

  describe('Business Rule 1 & 2 - Pitchability & Approval Status Determination', () => {
    it('1. Active + tie-up college can be pitched', async () => {
      prismaMock.college.findMany.mockResolvedValue([
        {
          id: validCollegeUuid1,
          name: 'Active TieUp College',
          isActive: true,
          hasTieUp: true,
          requiresApproval: false,
        },
      ]);

      const result = await service.create(createDto, mockUser.sub);
      expect(result).toBeDefined();
      expect(prismaMock.leadCollege.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              collegeId: validCollegeUuid1,
              approvalStatus: CollegeStatus.APPROVED,
            }),
          ]),
        }),
      );
    });

    it('2. Inactive + tie-up college is rejected', async () => {
      prismaMock.college.findMany.mockResolvedValue([
        {
          id: validCollegeUuid1,
          name: 'Inactive TieUp College',
          isActive: false,
          hasTieUp: true,
          requiresApproval: false,
        },
      ]);

      await expect(service.create(createDto, mockUser.sub)).rejects.toThrow(
        new BadRequestException(
          'This college is not currently available for pitching.',
        ),
      );
    });

    it('3. Active + no tie-up college is rejected', async () => {
      prismaMock.college.findMany.mockResolvedValue([
        {
          id: validCollegeUuid1,
          name: 'Active NoTieUp College',
          isActive: true,
          hasTieUp: false,
          requiresApproval: false,
        },
      ]);

      await expect(service.create(createDto, mockUser.sub)).rejects.toThrow(
        new BadRequestException(
          'This college is not currently available for pitching.',
        ),
      );
    });

    it('4. Inactive + no tie-up college is rejected', async () => {
      prismaMock.college.findMany.mockResolvedValue([
        {
          id: validCollegeUuid1,
          name: 'Inactive NoTieUp College',
          isActive: false,
          hasTieUp: false,
          requiresApproval: false,
        },
      ]);

      await expect(service.create(createDto, mockUser.sub)).rejects.toThrow(
        new BadRequestException(
          'This college is not currently available for pitching.',
        ),
      );
    });

    it('5. requiresApproval=false creates LeadCollege with approvalStatus=APPROVED', async () => {
      prismaMock.college.findMany.mockResolvedValue([
        {
          id: validCollegeUuid1,
          name: 'Standard College',
          isActive: true,
          hasTieUp: true,
          requiresApproval: false,
        },
      ]);

      await service.create(createDto, mockUser.sub);
      expect(prismaMock.leadCollege.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              collegeId: validCollegeUuid1,
              approvalStatus: CollegeStatus.APPROVED,
            }),
          ]),
        }),
      );
    });

    it('6. requiresApproval=true creates LeadCollege with approvalStatus=PENDING', async () => {
      prismaMock.college.findMany.mockResolvedValue([
        {
          id: validCollegeUuid1,
          name: 'Approval Required College',
          isActive: true,
          hasTieUp: true,
          requiresApproval: true,
        },
      ]);

      await service.create(createDto, mockUser.sub);
      expect(prismaMock.leadCollege.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              collegeId: validCollegeUuid1,
              approvalStatus: CollegeStatus.PENDING,
            }),
          ]),
        }),
      );
    });

    it('7. Existing duplicate LeadCollege behavior still works (skipDuplicates and ignoring existing pitches)', async () => {
      prismaMock.college.findMany.mockResolvedValue([
        {
          id: validCollegeUuid2,
          name: 'Second College',
          isActive: true,
          hasTieUp: true,
          requiresApproval: false,
        },
      ]);

      // Lead already has validCollegeUuid1 pitched
      prismaMock.leadCollege.findMany.mockResolvedValue([
        { collegeId: validCollegeUuid1 },
      ]);

      await service.update(
        validLeadUuid,
        { collegeIds: [validCollegeUuid1, validCollegeUuid2] },
        mockUser,
      );

      // Only validCollegeUuid2 should be passed to createMany, skipping existing validCollegeUuid1
      expect(prismaMock.leadCollege.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              collegeId: validCollegeUuid2,
              approvalStatus: CollegeStatus.APPROVED,
            }),
          ],
          skipDuplicates: true,
        }),
      );
    });
  });

  describe('Business Rule: LeadCollege Pipeline Approval Enforcement & Forward-Only Status Rule', () => {
    const statusLead = { id: 1, name: 'LEAD', displayOrder: 1, isActive: true };
    const statusApp = {
      id: 2,
      name: 'APPLICATION',
      displayOrder: 2,
      isActive: true,
    };
    const statusIntSched = {
      id: 3,
      name: 'INTERVIEW_SCHEDULED',
      displayOrder: 3,
      isActive: true,
    };

    const mockPaUserRecord = {
      id: validUserUuid,
      role: { name: 'PROGRAM_ADVISOR' },
    };

    beforeEach(() => {
      prismaMock.user = {
        findUnique: jest.fn().mockResolvedValue(mockPaUserRecord),
      };
    });

    it('1. Rejects pipeline update when LeadCollege approvalStatus is PENDING', async () => {
      const pendingLeadCollege = {
        id: 'lc-pending-1',
        leadId: validLeadUuid,
        collegeId: validCollegeUuid1,
        approvalStatus: CollegeStatus.PENDING,
        statusId: 1,
        status: statusLead,
      };

      prismaMock.lead.findUnique.mockResolvedValue({
        ...mockLead,
        collegeApplications: [pendingLeadCollege],
      });
      prismaMock.leadStatus.findUnique.mockResolvedValue(statusIntSched);

      await expect(
        service.updatePipeline(
          validLeadUuid,
          {
            statusId: 3,
            collegeId: validCollegeUuid1,
            interview: { scheduledAt: new Date().toISOString() },
          },
          mockUser,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'College pipeline cannot be changed until Manager approval is completed.',
        ),
      );
    });

    it('2. Allows pipeline update when LeadCollege approvalStatus is APPROVED and moving forward', async () => {
      const approvedLeadCollege = {
        id: 'lc-approved-1',
        leadId: validLeadUuid,
        collegeId: validCollegeUuid1,
        approvalStatus: CollegeStatus.APPROVED,
        statusId: 2,
        status: statusApp,
        college: { id: validCollegeUuid1, name: 'Test College' },
      };

      prismaMock.lead.findUnique.mockResolvedValue({
        ...mockLead,
        collegeApplications: [approvedLeadCollege],
      });
      prismaMock.leadStatus.findUnique.mockResolvedValue(statusIntSched);
      prismaMock.leadCollege.findFirst.mockResolvedValue(approvedLeadCollege);
      prismaMock.leadCollegeInterview.findFirst.mockResolvedValue(null);
      prismaMock.leadCollegeInterview.create.mockResolvedValue({ id: 'int-1' });
      prismaMock.leadCollege.update.mockResolvedValue({
        ...approvedLeadCollege,
        statusId: 3,
      });

      const result = await service.updatePipeline(
        validLeadUuid,
        {
          statusId: 3,
          collegeId: validCollegeUuid1,
          interview: { scheduledAt: new Date().toISOString() },
        },
        mockUser,
      );

      expect(result).toBeDefined();
    });

    it('3. Rejects Program Advisor attempting to move status backwards', async () => {
      const advancedLeadCollege = {
        id: 'lc-advanced-1',
        leadId: validLeadUuid,
        collegeId: validCollegeUuid1,
        approvalStatus: CollegeStatus.APPROVED,
        statusId: 3,
        status: statusIntSched,
      };

      prismaMock.lead.findUnique.mockResolvedValue({
        ...mockLead,
        collegeApplications: [advancedLeadCollege],
      });
      prismaMock.leadStatus.findUnique.mockResolvedValue(statusLead); // Trying to move to status displayOrder 1 from 3

      await expect(
        service.updatePipeline(
          validLeadUuid,
          {
            statusId: 1,
            collegeId: validCollegeUuid1,
          },
          mockUser,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Program Advisors cannot move pipeline status backwards.',
        ),
      );
    });

    it('4. Rejects pipeline update when LeadCollege approvalStatus is REJECTED', async () => {
      const rejectedLeadCollege = {
        id: 'lc-rejected-1',
        leadId: validLeadUuid,
        collegeId: validCollegeUuid1,
        approvalStatus: CollegeStatus.REJECTED,
        statusId: 1,
        status: statusLead,
      };

      prismaMock.lead.findUnique.mockResolvedValue({
        ...mockLead,
        collegeApplications: [rejectedLeadCollege],
      });
      prismaMock.leadStatus.findUnique.mockResolvedValue(statusIntSched);

      await expect(
        service.updatePipeline(
          validLeadUuid,
          {
            statusId: 3,
            collegeId: validCollegeUuid1,
            interview: { scheduledAt: new Date().toISOString() },
          },
          mockUser,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'This college pitch was rejected by the manager. Pipeline changes are not allowed.',
        ),
      );
    });

    it('5. Handles multiple colleges correctly (APPROVED can progress, PENDING is blocked)', async () => {
      const collegeApproved = {
        id: 'lc-app-1',
        leadId: validLeadUuid,
        collegeId: validCollegeUuid1,
        approvalStatus: CollegeStatus.APPROVED,
        statusId: 2,
        status: statusApp,
        college: { id: validCollegeUuid1, name: 'College A' },
      };
      const collegePending = {
        id: 'lc-app-2',
        leadId: validLeadUuid,
        collegeId: validCollegeUuid2,
        approvalStatus: CollegeStatus.PENDING,
        statusId: 1,
        status: statusLead,
        college: { id: validCollegeUuid2, name: 'College B' },
      };

      prismaMock.lead.findUnique.mockResolvedValue({
        ...mockLead,
        collegeApplications: [collegeApproved, collegePending],
      });
      prismaMock.leadStatus.findUnique.mockResolvedValue(statusIntSched);

      // Attempt update on PENDING College B -> should fail
      await expect(
        service.updatePipeline(
          validLeadUuid,
          {
            statusId: 3,
            collegeId: validCollegeUuid2,
            interview: { scheduledAt: new Date().toISOString() },
          },
          mockUser,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'College pipeline cannot be changed until Manager approval is completed.',
        ),
      );

      // Attempt update on APPROVED College A -> should succeed
      prismaMock.leadCollege.findFirst.mockResolvedValue(collegeApproved);
      prismaMock.leadCollegeInterview.findFirst.mockResolvedValue(null);
      prismaMock.leadCollegeInterview.create.mockResolvedValue({ id: 'int-2' });
      prismaMock.leadCollege.update.mockResolvedValue({
        ...collegeApproved,
        statusId: 3,
      });

      const result = await service.updatePipeline(
        validLeadUuid,
        {
          statusId: 3,
          collegeId: validCollegeUuid1,
          interview: { scheduledAt: new Date().toISOString() },
        },
        mockUser,
      );

      expect(result).toBeDefined();
    });
  });

  describe('Team Lead College Approvals Scope & Authorization', () => {
    const tlUserUuid = 'tl-user-1111-2222-3333-444444444444';
    const pa1Uuid = 'pa-1111-1111-1111-111111111111';
    const pa2Uuid = 'pa-2222-2222-2222-222222222222';
    const pa3Uuid = 'pa-3333-3333-3333-333333333333';

    it('1. should scope getPitchApprovals for Team Lead strictly to supervised PAs', async () => {
      const teamLeadAuthMock = service['teamLeadAuthService'] as any;
      teamLeadAuthMock.isTeamLead.mockResolvedValue(true);
      teamLeadAuthMock.getTeamLeadAdvisorIds.mockResolvedValue([pa1Uuid, pa2Uuid]);

      prismaMock.user.findUnique.mockResolvedValue({
        id: tlUserUuid,
        role: { name: 'Team Lead' },
      });
      prismaMock.leadCollege.findMany.mockResolvedValue([
        { id: 'pitch-1', pitchedById: pa1Uuid, approvalStatus: CollegeStatus.PENDING },
        { id: 'pitch-2', pitchedById: pa2Uuid, approvalStatus: CollegeStatus.PENDING },
      ]);

      const result = await service.getPitchApprovals({ sub: tlUserUuid }, 'TEAM', CollegeStatus.PENDING);

      expect(prismaMock.leadCollege.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            approvalStatus: CollegeStatus.PENDING,
            pitchedById: { in: [tlUserUuid, pa1Uuid, pa2Uuid] },
          }),
        }),
      );
      expect(result.length).toBe(2);
    });

    it('2. should return list with Team Lead own pitches for Team Lead with NO assigned PAs', async () => {
      const teamLeadAuthMock = service['teamLeadAuthService'] as any;
      teamLeadAuthMock.isTeamLead.mockResolvedValue(true);
      teamLeadAuthMock.getTeamLeadAdvisorIds.mockResolvedValue([]);

      prismaMock.user.findUnique.mockResolvedValue({
        id: tlUserUuid,
        role: { name: 'Team Lead' },
      });
      prismaMock.leadCollege.findMany.mockResolvedValue([]);

      const result = await service.getPitchApprovals({ sub: tlUserUuid }, 'TEAM');

      expect(prismaMock.leadCollege.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pitchedById: { in: [tlUserUuid] },
          }),
        }),
      );
      expect(result.length).toBe(0);
    });

    it('3. should allow Team Lead to approve a pitch for a supervised PA', async () => {
      const teamLeadAuthMock = service['teamLeadAuthService'] as any;
      teamLeadAuthMock.isTeamLead.mockResolvedValue(true);
      teamLeadAuthMock.getTeamLeadAdvisorIds.mockResolvedValue([pa1Uuid]);

      prismaMock.user.findUnique.mockResolvedValue({
        id: tlUserUuid,
        role: { name: 'Team Lead' },
      });
      prismaMock.leadCollege.findUnique.mockResolvedValue({
        id: 'pitch-100',
        pitchedById: pa1Uuid,
        approvalStatus: CollegeStatus.PENDING,
        lead: { firstName: 'Alice', lastName: 'Smith' },
        college: { name: 'Harvard Business' },
      });

      prismaMock.leadCollege.update.mockResolvedValue({
        id: 'pitch-100',
        approvalStatus: CollegeStatus.APPROVED,
        processedById: tlUserUuid,
      });
      prismaMock.notification.create.mockResolvedValue({ id: 'notif-1' });
      prismaMock.notificationRecipient.create.mockResolvedValue({});

      const res = await service.processPitchApproval('pitch-100', CollegeStatus.APPROVED, { sub: tlUserUuid });

      expect(prismaMock.leadCollege.update).toHaveBeenCalledWith({
        where: { id: 'pitch-100' },
        data: {
          approvalStatus: CollegeStatus.APPROVED,
          processedById: tlUserUuid,
        },
      });
    });

    it('4. should reject processPitchApproval with ForbiddenException if pitch belongs to unsupervised PA', async () => {
      const teamLeadAuthMock = service['teamLeadAuthService'] as any;
      teamLeadAuthMock.isTeamLead.mockResolvedValue(true);
      teamLeadAuthMock.getTeamLeadAdvisorIds.mockResolvedValue([pa1Uuid]);

      prismaMock.user.findUnique.mockResolvedValue({
        id: tlUserUuid,
        role: { name: 'Team Lead' },
      });
      prismaMock.leadCollege.findUnique.mockResolvedValue({
        id: 'pitch-200',
        pitchedById: pa3Uuid, // PA3 is NOT supervised by this Team Lead!
        approvalStatus: CollegeStatus.PENDING,
        lead: { firstName: 'Bob', lastName: 'Jones' },
        college: { name: 'Stanford Tech' },
      });

      await expect(
        service.processPitchApproval('pitch-200', CollegeStatus.APPROVED, { sub: tlUserUuid }),
      ).rejects.toThrow(
        'You can only process college approval requests for yourself or your supervised Program Advisors.',
      );
    });
  });

  describe('LeadCollege Status Isolation', () => {
    const leadCollegeA_Id = 'lc-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const leadCollegeB_Id = 'lc-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    const statusLead = { id: 1, name: 'LEAD', isActive: true, displayOrder: 1 };
    const statusInterview = { id: 3, name: 'INTERVIEW_SCHEDULED', isActive: true, displayOrder: 3 };

    const leadWithTwoColleges = {
      ...mockLead,
      statusId: 1,
      status: statusLead,
      assignments: [{ userId: validUserUuid, user: { id: validUserUuid, teamId: 1 }, status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000) }],
      collegeApplications: [
        {
          id: leadCollegeA_Id,
          leadId: validLeadUuid,
          collegeId: validCollegeUuid1,
          statusId: 1,
          status: statusLead,
          approvalStatus: 'APPROVED',
          college: { id: validCollegeUuid1, name: 'College A' },
        },
        {
          id: leadCollegeB_Id,
          leadId: validLeadUuid,
          collegeId: validCollegeUuid2,
          statusId: 1,
          status: statusLead,
          approvalStatus: 'APPROVED',
          college: { id: validCollegeUuid2, name: 'College B' },
        },
      ],
    };

    it('should update only the targeted LeadCollege status without touching Lead.statusId or other colleges', async () => {
      // Setup mocks
      prismaMock.lead.findUnique.mockResolvedValue(leadWithTwoColleges);
      prismaMock.leadStatus.findUnique.mockResolvedValue(statusInterview);
      prismaMock.user.findUnique.mockResolvedValue({
        id: validUserUuid,
        role: { name: 'PROGRAM_ADVISOR' },
      });

      // resolveLeadCollege will find college A by leadCollegeId
      prismaMock.leadCollege.findFirst.mockResolvedValue({
        id: leadCollegeA_Id,
        leadId: validLeadUuid,
        collegeId: validCollegeUuid1,
        statusId: 1,
        approvalStatus: 'APPROVED',
        college: { id: validCollegeUuid1, name: 'College A' },
        status: statusLead,
      });

      prismaMock.leadCollegeInterview.findFirst.mockResolvedValue(null);
      prismaMock.leadCollegeInterview.create.mockResolvedValue({ id: 'int-1' });
      prismaMock.leadCollegeHistory.create.mockResolvedValue({ id: 'hist-1' });
      prismaMock.activityLog.create.mockResolvedValue({});
      prismaMock.leadCollege.update.mockResolvedValue({
        id: leadCollegeA_Id,
        statusId: statusInterview.id,
      });

      // Return refreshed lead after update
      prismaMock.lead.findUnique
        .mockResolvedValueOnce(leadWithTwoColleges) // First call: re-fetch lead
        .mockResolvedValueOnce({
          ...leadWithTwoColleges,
          // Lead.statusId should remain 1 (LEAD), NOT change to 3 (INTERVIEW_SCHEDULED)
          statusId: 1,
          collegeApplications: [
            { ...leadWithTwoColleges.collegeApplications[0], statusId: statusInterview.id },
            { ...leadWithTwoColleges.collegeApplications[1] }, // College B unchanged
          ],
        });

      await service.updatePipeline(
        validLeadUuid,
        {
          statusId: statusInterview.id,
          collegeId: validCollegeUuid1,
          leadCollegeId: leadCollegeA_Id,
          interview: { scheduledAt: new Date().toISOString() },
        },
        { sub: validUserUuid },
        'ALL',
      );

      // 1. LeadCollege A should have been updated to INTERVIEW_SCHEDULED
      expect(prismaMock.leadCollege.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: leadCollegeA_Id },
          data: { statusId: statusInterview.id },
        }),
      );

      // 2. Lead.statusId should NOT have been updated (college-specific transition)
      const leadUpdateCalls = prismaMock.lead.update.mock.calls;
      const globalStatusUpdates = leadUpdateCalls.filter(
        (call: any[]) => call[0]?.data?.statusId === statusInterview.id,
      );
      expect(globalStatusUpdates.length).toBe(0);

      // 3. LeadCollegeHistory should record the correct per-college fromStatusId
      expect(prismaMock.leadCollegeHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadCollegeId: leadCollegeA_Id,
            fromStatusId: 1, // College A's own previous statusId, NOT Lead.statusId
            toStatusId: statusInterview.id,
          }),
        }),
      );
    });
  });

  describe('Program Advisor Lead Ownership Enforcement (findAll)', () => {
    const advisorUserId = 'advisor-uuid-1111';
    const otherUserId = 'advisor-uuid-2222';

    beforeEach(() => {
      prismaMock.team.findMany.mockResolvedValue([]);
      prismaMock.teamMember.findMany.mockResolvedValue([]);
      teamLeadAuthService.isTeamLead.mockResolvedValue(false);
    });

    it('should reject a Program Advisor trying to filter by another advisor ownerId with ForbiddenException', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: advisorUserId,
        role: { name: 'PROGRAM_ADVISOR' },
        teamId: 10,
      });

      await expect(
        service.findAll(
          { sub: advisorUserId },
          { ownerId: otherUserId },
          'OWN',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject a Program Advisor trying to filter by UNASSIGNED ownerId with ForbiddenException', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: advisorUserId,
        role: { name: 'PA' },
        teamId: 10,
      });

      await expect(
        service.findAll(
          { sub: advisorUserId },
          { ownerId: 'UNASSIGNED' },
          'OWN',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow a Program Advisor to query their own leads without ownerId filter', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: advisorUserId,
        role: { name: 'PROGRAM_ADVISOR' },
        teamId: 10,
      });
      prismaMock.lead.findMany.mockResolvedValue([]);
      prismaMock.lead.count.mockResolvedValue(0);

      const result = await service.findAll(
        { sub: advisorUserId },
        {},
        'OWN',
      );

      expect(result).toBeDefined();
      expect(prismaMock.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: [
                  { assignments: { some: { userId: advisorUserId } } },
                  {
                    createdById: advisorUserId,
                    assignments: {
                      none: {
                        userId: { not: advisorUserId },
                        status: 'ACTIVE',
                        expiresAt: expect.any(Object),
                      },
                    },
                  },
                ],
              }),
            ]),
          }),
        }),
      );
    });

    it('should allow Super Admin or Manager to filter by any ownerId', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'manager-uuid-9999',
        role: { name: 'MANAGER' },
        teamId: 10,
      });
      prismaMock.lead.findMany.mockResolvedValue([]);
      prismaMock.lead.count.mockResolvedValue(0);

      const result = await service.findAll(
        { sub: 'manager-uuid-9999' },
        { ownerId: otherUserId },
        'MANAGED',
      );

      expect(result).toBeDefined();
    });
  });
});
