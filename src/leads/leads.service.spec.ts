import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CollegeStatus, LeadSource } from '@prisma/client';

describe('LeadsService - College Pitch Approval Rules', () => {
  let service: LeadsService;
  let prismaMock: any;

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
      },
      leadOwnershipHistory: {
        create: jest.fn().mockResolvedValue({}),
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
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
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
});
