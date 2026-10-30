import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import { EmailService } from '../email/email.service';
import { BadRequestException } from '@nestjs/common';
import { LeadSource } from '@prisma/client';

describe('LeadsService - Preferred Study Location, Budget, and Reference Lead Source', () => {
  let service: LeadsService;
  let prismaMock: any;

  const mockUserId = '11111111-1111-1111-1111-111111111111';
  const mockUser = {
    sub: mockUserId,
    role: 'SUPER_ADMIN',
  };

  const defaultStatus = {
    id: 1,
    name: 'NEW_LEAD',
    displayOrder: 1,
    isActive: true,
  };

  const mockCollege = {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    name: 'Test Business School',
    isActive: true,
    hasTieUp: true,
    requiresApproval: false,
  };

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn().mockImplementation((cb) => cb(prismaMock)),
      lead: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      leadStatus: {
        findFirst: jest.fn().mockResolvedValue(defaultStatus),
        findUnique: jest.fn().mockResolvedValue(defaultStatus),
      },
      college: {
        findMany: jest.fn().mockResolvedValue([mockCollege]),
        findFirst: jest.fn().mockResolvedValue(mockCollege),
      },
      leadCollege: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      leadAssignment: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 86400000),
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: mockUserId,
          role: { name: 'SUPER_ADMIN' },
          teamId: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
      leadAcknowledgement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      leadNegativeCollege: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      leadOwnershipHistory: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn().mockResolvedValue({}),
            emitLeadCreated: jest.fn(),
          },
        },
        {
          provide: TeamLeadAuthorizationService,
          useValue: {
            isTeamLead: jest.fn().mockResolvedValue(false),
            getTeamLeadAssignedTeamIds: jest.fn().mockResolvedValue([]),
            canTeamLeadAccessLead: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendCounsellingConfirmation: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
  });

  describe('1. Create Lead with all new fields empty', () => {
    it('should create lead with null preferredState, preferredCity, preferredBudget, referredBy', async () => {
      prismaMock.lead.create.mockImplementation(({ data }: any) => {
        return {
          id: 'lead-empty-pref',
          ...data,
          status: defaultStatus,
          assignments: [],
        };
      });

      await service.create(
        {
          firstName: 'Rahul',
          phone: '9876543210',
          email: 'rahul@example.com',
          city: 'Sagar',
          state: 'Madhya Pradesh',
          source: LeadSource.OTHER,
          sourceOther: 'Website',
          collegeIds: [mockCollege.id],
        } as any,
        mockUserId,
      );

      expect(prismaMock.lead.create).toHaveBeenCalled();
      const createdData = prismaMock.lead.create.mock.calls[0][0].data;

      // Residential fields preserved
      expect(createdData.city).toBe('Sagar');
      expect(createdData.state).toBe('Madhya Pradesh');

      // Preference fields defaulted safely to null
      expect(createdData.preferredState).toBeNull();
      expect(createdData.preferredCity).toBeNull();
      expect(createdData.preferredBudget).toBeNull();
      expect(createdData.referredBy).toBeNull();
      expect(createdData.source).toBe(LeadSource.OTHER);
    });
  });

  describe('2. Preferred Study Location independent of Residential Location', () => {
    it('should store preferredState and preferredCity separately from residential state and city', async () => {
      prismaMock.lead.create.mockImplementation(({ data }: any) => {
        return {
          id: 'lead-pref-loc',
          ...data,
          status: defaultStatus,
          assignments: [],
        };
      });

      await service.create(
        {
          firstName: 'Ananya',
          phone: '9876543211',
          email: 'ananya@example.com',
          city: 'Sagar',
          state: 'Madhya Pradesh',
          preferredState: 'Karnataka',
          preferredCity: 'Bengaluru',
          source: LeadSource.CAT,
          collegeIds: [mockCollege.id],
        } as any,
        mockUserId,
      );

      const createdData = prismaMock.lead.create.mock.calls[0][0].data;
      expect(createdData.city).toBe('Sagar');
      expect(createdData.state).toBe('Madhya Pradesh');
      expect(createdData.preferredState).toBe('Karnataka');
      expect(createdData.preferredCity).toBe('Bengaluru');
    });
  });

  describe('3. Preferred Budget Handling', () => {
    it('should accept valid budget (e.g. 800000) and persist as number', async () => {
      prismaMock.lead.create.mockImplementation(({ data }: any) => ({
        id: 'lead-budget',
        ...data,
        status: defaultStatus,
        assignments: [],
      }));

      await service.create(
        {
          firstName: 'Amit',
          phone: '9876543212',
          email: 'amit@example.com',
          city: 'Pune',
          state: 'Maharashtra',
          preferredBudget: 800000,
          source: LeadSource.CAT,
          collegeIds: [mockCollege.id],
        } as any,
        mockUserId,
      );

      const createdData = prismaMock.lead.create.mock.calls[0][0].data;
      expect(createdData.preferredBudget).toBe(800000);
    });

    it('should accept zero budget (0)', async () => {
      prismaMock.lead.create.mockImplementation(({ data }: any) => ({
        id: 'lead-budget-zero',
        ...data,
        status: defaultStatus,
        assignments: [],
      }));

      await service.create(
        {
          firstName: 'Pooja',
          phone: '9876543213',
          email: 'pooja@example.com',
          city: 'Delhi',
          state: 'Delhi',
          preferredBudget: 0,
          source: LeadSource.CAT,
          collegeIds: [mockCollege.id],
        } as any,
        mockUserId,
      );

      const createdData = prismaMock.lead.create.mock.calls[0][0].data;
      expect(createdData.preferredBudget).toBe(0);
    });

    it('should reject negative budget on lead creation', async () => {
      await expect(
        service.create(
          {
            firstName: 'Bad',
            phone: '9876543214',
            email: 'bad@example.com',
            city: 'Delhi',
            state: 'Delhi',
            preferredBudget: -500,
            source: LeadSource.CAT,
            collegeIds: [mockCollege.id],
          } as any,
          mockUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject negative budget on lead update', async () => {
      prismaMock.lead.findUnique.mockResolvedValue({
        id: '44444444-4444-4444-4444-444444444444',
        createdById: mockUserId,
        assignments: [
          {
            userId: mockUserId,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 86400000),
          },
        ],
      });

      await expect(
        service.update(
          '44444444-4444-4444-4444-444444444444',
          { preferredBudget: -100 } as any,
          mockUser,
          'ALL',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Reference Lead Source & Referred By', () => {
    it('should store REFERENCE source and referredBy field', async () => {
      prismaMock.lead.create.mockImplementation(({ data }: any) => ({
        id: 'lead-ref',
        ...data,
        status: defaultStatus,
        assignments: [],
      }));

      await service.create(
        {
          firstName: 'Sneha',
          phone: '9876543215',
          email: 'sneha@example.com',
          city: 'Mumbai',
          state: 'Maharashtra',
          source: LeadSource.REFERENCE,
          referredBy: 'Dr. Suresh Sharma',
          collegeIds: [mockCollege.id],
        } as any,
        mockUserId,
      );

      const createdData = prismaMock.lead.create.mock.calls[0][0].data;
      expect(createdData.source).toBe(LeadSource.REFERENCE);
      expect(createdData.referredBy).toBe('Dr. Suresh Sharma');
    });

    it('should update lead preferences and referral without resetting unrelated fields', async () => {
      const existingLead = {
        id: '44444444-4444-4444-4444-444444444444',
        firstName: 'Sneha',
        lastName: 'Patil',
        phone: '9876543215',
        city: 'Mumbai',
        state: 'Maharashtra',
        createdById: mockUserId,
        assignments: [
          {
            userId: mockUserId,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 86400000),
          },
        ],
      };

      prismaMock.lead.findUnique.mockResolvedValue(existingLead);
      prismaMock.lead.update.mockImplementation(({ data }: any) => ({
        ...existingLead,
        ...data,
        status: defaultStatus,
      }));

      await service.update(
        '44444444-4444-4444-4444-444444444444',
        {
          preferredState: 'Karnataka',
          preferredCity: 'Bengaluru',
          preferredBudget: 650000,
          source: LeadSource.REFERENCE,
          referredBy: 'Prof. Rao',
        } as any,
        mockUser,
        'ALL',
      );

      const updateData = prismaMock.lead.update.mock.calls[0][0].data;
      expect(updateData.preferredState).toBe('Karnataka');
      expect(updateData.preferredCity).toBe('Bengaluru');
      expect(updateData.preferredBudget).toBe(650000);
      expect(updateData.source).toBe(LeadSource.REFERENCE);
      expect(updateData.referredBy).toBe('Prof. Rao');
      // Residential fields were untouched
      expect(updateData.city).toBeUndefined();
      expect(updateData.state).toBeUndefined();
    });
  });
});
