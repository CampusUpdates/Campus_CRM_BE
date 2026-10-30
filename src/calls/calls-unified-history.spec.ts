import { Test, TestingModule } from '@nestjs/testing';
import { CallsService } from './calls.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { CallOutcome, DataAssignmentStatus } from '@prisma/client';
import { normalizePhone, getPhoneQueryCandidates } from '../common/utils/phone.util';

describe('Unified Call History & Single-Lead Regression Suite', () => {
  let service: CallsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      studentData: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      lead: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      callRecord: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      dataAssignment: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
  });

  describe('Phone Normalization & Query Candidates', () => {
    it('normalizes 10-digit Indian numbers with formatting, spaces, +91, 0 prefixes', () => {
      expect(normalizePhone('9876543210')).toBe('9876543210');
      expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
      expect(normalizePhone('+91-98765-43210')).toBe('9876543210');
      expect(normalizePhone('(91) 9876543210')).toBe('9876543210');
      expect(normalizePhone('09876543210')).toBe('9876543210');
      expect(normalizePhone('919876543210')).toBe('9876543210');
    });

    it('generates candidates covering standard variations for indexed lookups', () => {
      const candidates = getPhoneQueryCandidates('9876543210');
      expect(candidates).toContain('9876543210');
      expect(candidates).toContain('+919876543210');
      expect(candidates).toContain('919876543210');
      expect(candidates).toContain('09876543210');
    });
  });

  describe('HIST-01: Same phone in CAT and NMAT shows combined history', () => {
    it('returns combined call records from all matching student records for both CAT and NMAT lookups', async () => {
      const catStudent = {
        id: 'sd-cat',
        phone: '9876543210',
        firstName: 'Rahul',
        category: { id: 'cat-id', name: 'CAT' },
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      };
      const nmatStudent = {
        id: 'sd-nmat',
        phone: '+91 98765 43210',
        firstName: 'Rahul',
        category: { id: 'nmat-id', name: 'NMAT' },
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      };

      const callCat = {
        id: 'call-1',
        studentDataId: 'sd-cat',
        outcome: CallOutcome.INTERESTED,
        createdAt: new Date('2026-10-20T10:00:00Z'),
        createdBy: { id: 'adv-1', firstName: 'Alice', lastName: 'A' },
      };
      const callNmat = {
        id: 'call-2',
        studentDataId: 'sd-nmat',
        outcome: CallOutcome.FOLLOW_UP,
        createdAt: new Date('2026-10-21T11:00:00Z'),
        createdBy: { id: 'adv-2', firstName: 'Bob', lastName: 'B' },
      };

      prismaMock.studentData.findUnique.mockResolvedValue(catStudent);
      prismaMock.studentData.findMany.mockResolvedValue([
        { id: 'sd-cat', phone: '9876543210' },
        { id: 'sd-nmat', phone: '+91 98765 43210' },
      ]);
      prismaMock.lead.findMany.mockResolvedValue([]);
      prismaMock.callRecord.findMany.mockResolvedValue([callNmat, callCat]);

      const catHistory = await service.getCallHistory('sd-cat', 'advisor-1');
      expect(catHistory).toHaveLength(2);
      expect(catHistory[0].id).toBe('call-2');
      expect(catHistory[1].id).toBe('call-1');

      expect(prismaMock.callRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { studentDataId: { in: ['sd-cat', 'sd-nmat'] } },
            ],
          },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('HIST-02: Same phone in 3+ categories displays each call record once', () => {
    it('queries all matching student records and returns each distinct call record once', async () => {
      const studentCat = {
        id: 'sd-cat',
        phone: '9876543210',
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      };

      prismaMock.studentData.findUnique.mockResolvedValue(studentCat);
      prismaMock.studentData.findMany.mockResolvedValue([
        { id: 'sd-cat', phone: '9876543210' },
        { id: 'sd-nmat', phone: '+91 98765 43210' },
        { id: 'sd-mhcet', phone: '09876543210' },
      ]);
      prismaMock.lead.findMany.mockResolvedValue([]);

      const mockCalls = [
        { id: 'call-3', studentDataId: 'sd-mhcet', outcome: CallOutcome.INTERESTED, createdAt: new Date('2026-10-22') },
        { id: 'call-2', studentDataId: 'sd-nmat', outcome: CallOutcome.CALL_BACK_LATER, createdAt: new Date('2026-10-21') },
        { id: 'call-1', studentDataId: 'sd-cat', outcome: CallOutcome.NO_ANSWER, createdAt: new Date('2026-10-20') },
      ];
      prismaMock.callRecord.findMany.mockResolvedValue(mockCalls);

      const history = await service.getCallHistory('sd-cat', 'advisor-1');
      expect(history).toHaveLength(3);
      const ids = history.map((h: any) => h.id);
      expect(ids).toEqual(['call-3', 'call-2', 'call-1']);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('HIST-03: Calls made by different authorized advisors appear in chronological order', () => {
    it('sorts newest first with advisor information included', async () => {
      const student = {
        id: 'sd-1',
        phone: '9876543210',
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      };
      prismaMock.studentData.findUnique.mockResolvedValue(student);
      prismaMock.studentData.findMany.mockResolvedValue([{ id: 'sd-1', phone: '9876543210' }]);
      prismaMock.lead.findMany.mockResolvedValue([]);

      const olderCall = {
        id: 'call-old',
        studentDataId: 'sd-1',
        outcome: CallOutcome.NO_ANSWER,
        createdAt: new Date('2026-10-20T09:00:00Z'),
        createdBy: { id: 'adv-a', firstName: 'Advisor', lastName: 'Alpha' },
      };
      const newerCall = {
        id: 'call-new',
        studentDataId: 'sd-1',
        outcome: CallOutcome.INTERESTED,
        createdAt: new Date('2026-10-22T14:30:00Z'),
        createdBy: { id: 'adv-b', firstName: 'Advisor', lastName: 'Beta' },
      };

      prismaMock.callRecord.findMany.mockResolvedValue([newerCall, olderCall]);

      const history = await service.getCallHistory('sd-1', 'advisor-1');
      expect(history[0].id).toBe('call-new');
      expect(history[0].createdBy.firstName).toBe('Advisor');
      expect(history[0].createdBy.lastName).toBe('Beta');
      expect(history[1].id).toBe('call-old');
      expect(history[1].createdBy.lastName).toBe('Alpha');
    });
  });

  describe('HIST-04: Different phone numbers never share history', () => {
    it('isolates call records when normalized phones differ', async () => {
      const studentA = {
        id: 'sd-a',
        phone: '9876543210',
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      };

      prismaMock.studentData.findUnique.mockResolvedValue(studentA);
      prismaMock.studentData.findMany.mockResolvedValue([{ id: 'sd-a', phone: '9876543210' }]);
      prismaMock.lead.findMany.mockResolvedValue([]);
      prismaMock.callRecord.findMany.mockResolvedValue([
        { id: 'call-a', studentDataId: 'sd-a', outcome: CallOutcome.NO_ANSWER },
      ]);

      const history = await service.getCallHistory('sd-a', 'advisor-1');
      expect(history).toHaveLength(1);
      expect(history[0].studentDataId).toBe('sd-a');

      expect(prismaMock.callRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { studentDataId: { in: ['sd-a'] } },
            ],
          },
        }),
      );
    });
  });

  describe('HIST-05: Opening a different category record refreshes the displayed history', () => {
    it('fetches respective unified history when studentDataId changes', async () => {
      prismaMock.studentData.findUnique.mockResolvedValueOnce({
        id: 'sd-cat',
        phone: '9876543210',
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      });
      prismaMock.studentData.findMany.mockResolvedValueOnce([{ id: 'sd-cat', phone: '9876543210' }]);
      prismaMock.lead.findMany.mockResolvedValueOnce([]);
      prismaMock.callRecord.findMany.mockResolvedValueOnce([{ id: 'call-cat' }]);

      const res1 = await service.getCallHistory('sd-cat', 'advisor-1');
      expect(res1[0].id).toBe('call-cat');

      prismaMock.studentData.findUnique.mockResolvedValueOnce({
        id: 'sd-mhcet-other',
        phone: '9998887776',
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      });
      prismaMock.studentData.findMany.mockResolvedValueOnce([{ id: 'sd-mhcet-other', phone: '9998887776' }]);
      prismaMock.lead.findMany.mockResolvedValueOnce([]);
      prismaMock.callRecord.findMany.mockResolvedValueOnce([{ id: 'call-mhcet-other' }]);

      const res2 = await service.getCallHistory('sd-mhcet-other', 'advisor-1');
      expect(res2[0].id).toBe('call-mhcet-other');
    });
  });

  describe('HIST-06: Slicing the latest three records for Call Workspace UI', () => {
    it('returns history ordered newest first allowing workspace to display top 3', async () => {
      prismaMock.studentData.findUnique.mockResolvedValue({
        id: 'sd-1',
        phone: '9876543210',
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      });
      prismaMock.studentData.findMany.mockResolvedValue([{ id: 'sd-1', phone: '9876543210' }]);
      prismaMock.lead.findMany.mockResolvedValue([]);

      const mockCalls = [
        { id: 'c-5', createdAt: new Date('2026-10-22T12:00:00Z') },
        { id: 'c-4', createdAt: new Date('2026-10-22T11:00:00Z') },
        { id: 'c-3', createdAt: new Date('2026-10-22T10:00:00Z') },
        { id: 'c-2', createdAt: new Date('2026-10-22T09:00:00Z') },
        { id: 'c-1', createdAt: new Date('2026-10-22T08:00:00Z') },
      ];
      prismaMock.callRecord.findMany.mockResolvedValue(mockCalls);

      const history = await service.getCallHistory('sd-1', 'advisor-1');
      const latestThree = history.slice(0, 3);
      expect(latestThree).toHaveLength(3);
      expect(latestThree.map((c: any) => c.id)).toEqual(['c-5', 'c-4', 'c-3']);
    });
  });

  describe('AUTH-01: Authorization enforcement on call history access', () => {
    it('throws ForbiddenException when advisor is not assigned and has no supervision or past calls', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'advisor-unauthorized', role: { name: 'ADVISOR' } });
      prismaMock.studentData.findUnique.mockResolvedValue({
        id: 'sd-secret',
        phone: '9876543210',
        assignmentItems: [],
        callRecords: [],
      });

      await expect(
        service.getCallHistory('sd-secret', 'advisor-unauthorized', 2),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Admin or Manager to view call history regardless of assignment', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-1', role: { name: 'SUPER_ADMIN' } });
      prismaMock.studentData.findUnique.mockResolvedValue({
        id: 'sd-any',
        phone: '9876543210',
      });
      prismaMock.studentData.findMany.mockResolvedValue([{ id: 'sd-any', phone: '9876543210' }]);
      prismaMock.lead.findMany.mockResolvedValue([]);
      prismaMock.callRecord.findMany.mockResolvedValue([]);

      const history = await service.getCallHistory('sd-any', 'admin-1', 1);
      expect(history).toEqual([]);
    });
  });

  describe('LEAD-01 & LEAD-02: Lead association validation in call outcome', () => {
    it('accepts leadId when phone matches via normalization even if formatting differs', async () => {
      prismaMock.studentData.findUnique.mockResolvedValue({
        id: 'sd-101',
        phone: '+91 98765 43210',
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      });
      prismaMock.lead.findUnique.mockResolvedValue({
        id: 'lead-1',
        phone: '9876543210',
      });
      prismaMock.callRecord.create.mockResolvedValue({
        id: 'cr-1',
        studentDataId: 'sd-101',
        leadId: 'lead-1',
        outcome: CallOutcome.INTERESTED,
      });

      const result = await service.createCallOutcome(
        {
          studentDataId: 'sd-101',
          leadId: 'lead-1',
          outcome: CallOutcome.INTERESTED,
        },
        'advisor-1',
      );

      expect(result.id).toBe('cr-1');
      expect(prismaMock.callRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studentDataId: 'sd-101',
            leadId: 'lead-1',
          }),
        }),
      );
    });

    it('rejects leadId when normalized phone does not match contact phone', async () => {
      prismaMock.studentData.findUnique.mockResolvedValue({
        id: 'sd-101',
        phone: '9876543210',
        assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: DataAssignmentStatus.ACTIVE } }],
      });
      prismaMock.lead.findUnique.mockResolvedValue({
        id: 'lead-different',
        phone: '9111111111',
      });

      await expect(
        service.createCallOutcome(
          {
            studentDataId: 'sd-101',
            leadId: 'lead-different',
            outcome: CallOutcome.INTERESTED,
          },
          'advisor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('ASSIGN-01: Category-specific assignments and advisor queues remain unchanged', () => {
    it('preserves distinct student records and category metadata in advisor batch queue', async () => {
      const mockAssignments = [
        {
          id: 'assign-cat',
          assignedAt: new Date('2026-10-20'),
          expiresAt: new Date('2026-10-25'),
          status: DataAssignmentStatus.ACTIVE,
          items: [
            {
              id: 1,
              studentData: {
                id: 'sd-cat-1',
                firstName: 'Student',
                lastName: 'CAT',
                phone: '9876543210',
                createdAt: new Date('2026-10-20'),
                category: { id: 'cat-uuid', name: 'CAT' },
                upload: { id: 'up-1', fileName: 'cat_leads.xlsx', uploadedAt: new Date() },
              },
            },
          ],
        },
        {
          id: 'assign-nmat',
          assignedAt: new Date('2026-10-21'),
          expiresAt: new Date('2026-10-26'),
          status: DataAssignmentStatus.ACTIVE,
          items: [
            {
              id: 2,
              studentData: {
                id: 'sd-nmat-1',
                firstName: 'Student',
                lastName: 'NMAT',
                phone: '+91 98765 43210',
                createdAt: new Date('2026-10-21'),
                category: { id: 'nmat-uuid', name: 'NMAT' },
                upload: { id: 'up-2', fileName: 'nmat_leads.xlsx', uploadedAt: new Date() },
              },
            },
          ],
        },
      ];

      prismaMock.dataAssignment.findMany.mockResolvedValue(mockAssignments);
      prismaMock.callRecord.findMany.mockResolvedValue([]);

      const queueResponse = await service.getCallQueue('advisor-1');
      expect(queueResponse.items).toHaveLength(2);

      expect(queueResponse.items[0].studentDataId).toBe('sd-cat-1');
      expect(queueResponse.items[0].category.name).toBe('CAT');
      expect(queueResponse.items[0].assignment.id).toBe('assign-cat');

      expect(queueResponse.items[1].studentDataId).toBe('sd-nmat-1');
      expect(queueResponse.items[1].category.name).toBe('NMAT');
      expect(queueResponse.items[1].assignment.id).toBe('assign-nmat');
    });
  });
});
