import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { CollegeStatus } from '@prisma/client';

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
    assignments: [{ userId: validUserUuid, status: 'ACTIVE' }],
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
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pitch-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      leadAssignment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb) => cb(prismaMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prismaMock },
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
        new BadRequestException('This college is not currently available for pitching.'),
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
        new BadRequestException('This college is not currently available for pitching.'),
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
        new BadRequestException('This college is not currently available for pitching.'),
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
});
