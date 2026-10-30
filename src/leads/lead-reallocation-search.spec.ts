import { Test, TestingModule } from '@nestjs/testing';
import { LeadReallocationService } from './lead-reallocation.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LeadReallocationService - Search & Scoping on Lead Reallocation', () => {
  let service: LeadReallocationService;
  let mockPrisma: any;

  const mockLead = {
    id: 'lead-test-1111-2222-3333',
    firstName: 'Priyanshu',
    lastName: 'Soni',
    phone: '9039196670',
    email: 'priyanshu@example.com',
    courseInterested: 'MBA',
    status: { id: 1, name: 'LEAD', color: 'blue' },
    createdAt: new Date(),
    assignments: [
      {
        id: 1,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 86400000),
        user: {
          id: 'user-pa-1',
          firstName: 'John',
          lastName: 'Doe',
          role: { id: 2, name: 'Program Advisor' },
          team: { id: 1, name: 'Team Alpha' },
        },
      },
    ],
    ownershipHistories: [],
    callRecords: [],
    finalCollege: {
      id: 'college-1',
      name: 'Amity University',
      city: 'Noida',
      state: 'Uttar Pradesh',
    },
    collegeApplications: [
      {
        id: 'app-1',
        college: {
          id: 'college-1',
          name: 'Amity University',
          city: 'Noida',
          state: 'Uttar Pradesh',
        },
        status: { id: 1, name: 'LEAD' },
      },
    ],
  };

  beforeEach(async () => {
    mockPrisma = {
      lead: {
        findMany: jest.fn().mockResolvedValue([mockLead]),
        count: jest.fn().mockResolvedValue(1),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadReallocationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LeadReallocationService>(LeadReallocationService);
  });

  it('should search leads by phone number and include college info', async () => {
    const result = await service.getLeadsForReallocation({ search: '903919' } as any);

    expect(mockPrisma.lead.findMany).toHaveBeenCalled();
    const callArgs = mockPrisma.lead.findMany.mock.calls[0][0];

    // Verify search term appears in where.OR
    expect(callArgs.where.OR).toBeDefined();
    const phoneCondition = callArgs.where.OR.find((c: any) => c.phone);
    expect(phoneCondition).toEqual({ phone: { contains: '903919', mode: 'insensitive' } });

    // Verify result contains college applications and final college
    expect(result.data).toHaveLength(1);
    expect(result.data[0].phone).toBe('9039196670');
    expect(result.data[0].finalCollege?.name).toBe('Amity University');
    expect(result.data[0].collegeApplications?.[0]?.college?.name).toBe('Amity University');
  });

  it('should search leads by multi-word name (first name + last name)', async () => {
    await service.getLeadsForReallocation({ search: 'Priyanshu Soni' } as any);

    const callArgs = mockPrisma.lead.findMany.mock.calls[0][0];
    expect(callArgs.where.OR).toBeDefined();

    // Must have AND condition for multi-word splitting
    const multiWordCondition = callArgs.where.OR.find((c: any) => c.AND);
    expect(multiWordCondition).toBeDefined();
    expect(multiWordCondition.AND).toHaveLength(2);
  });

  it('should search leads by college name', async () => {
    await service.getLeadsForReallocation({ search: 'Amity' } as any);

    const callArgs = mockPrisma.lead.findMany.mock.calls[0][0];
    expect(callArgs.where.OR).toBeDefined();

    const collegeAppCondition = callArgs.where.OR.find((c: any) => c.collegeApplications);
    expect(collegeAppCondition).toEqual({
      collegeApplications: {
        some: {
          college: {
            name: { contains: 'Amity', mode: 'insensitive' },
          },
        },
      },
    });

    const finalCollegeCondition = callArgs.where.OR.find((c: any) => c.finalCollege);
    expect(finalCollegeCondition).toEqual({
      finalCollege: {
        name: { contains: 'Amity', mode: 'insensitive' },
      },
    });
  });

  it('should perform direct lookup when leadId is provided', async () => {
    await service.getLeadsForReallocation({ leadId: 'lead-test-1111-2222-3333' } as any);

    const callArgs = mockPrisma.lead.findMany.mock.calls[0][0];
    expect(callArgs.where.id).toBe('lead-test-1111-2222-3333');
  });
});
