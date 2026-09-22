import { Test, TestingModule } from '@nestjs/testing';
import { CallsService } from './calls.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CallOutcome } from '@prisma/client';

describe('CallsService - Call Outcome History Persistence', () => {
  let service: CallsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      studentData: {
        findUnique: jest.fn(),
      },
      lead: {
        findUnique: jest.fn(),
      },
      callRecord: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const mockTelephonyProvider = {
      initiateCall: jest.fn(),
      endCall: jest.fn(),
      getCallStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: 'TelephonyProvider', useValue: mockTelephonyProvider },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
  });

  it('1. Authorized StudentData -> CallRecord successfully created', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [
        {
          assignment: {
            id: 'assign-1',
            assignedToId: 'advisor-1',
            status: 'ACTIVE',
          },
        },
      ],
    });

    const expectedRecord = {
      id: 'cr-1',
      studentDataId: 'sd-101',
      leadId: null,
      createdById: 'advisor-1',
      outcome: CallOutcome.NO_ANSWER,
      notes: 'No answer after 3 rings',
      startedAt: new Date('2026-09-22T10:00:00Z'),
      endedAt: new Date('2026-09-22T10:00:15Z'),
      durationSeconds: 15,
      createdAt: new Date(),
    };

    prismaMock.callRecord.create.mockResolvedValue(expectedRecord);

    const result = await service.createCallOutcome(
      {
        studentDataId: 'sd-101',
        outcome: CallOutcome.NO_ANSWER,
        notes: 'No answer after 3 rings',
        startedAt: '2026-09-22T10:00:00Z',
        endedAt: '2026-09-22T10:00:15Z',
        durationSeconds: 15,
      },
      'advisor-1',
    );

    expect(prismaMock.studentData.findUnique).toHaveBeenCalledWith({
      where: { id: 'sd-101' },
      include: expect.any(Object),
    });

    expect(prismaMock.callRecord.create).toHaveBeenCalledWith({
      data: {
        studentDataId: 'sd-101',
        leadId: null,
        createdById: 'advisor-1',
        outcome: CallOutcome.NO_ANSWER,
        notes: 'No answer after 3 rings',
        startedAt: new Date('2026-09-22T10:00:00Z'),
        endedAt: new Date('2026-09-22T10:00:15Z'),
        durationSeconds: 15,
      },
    });

    expect(result).toEqual(expectedRecord);
  });

  it('2. Two calls for the same StudentData -> two independent CallRecord records', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: 'ACTIVE' } }],
    });

    prismaMock.callRecord.create
      .mockResolvedValueOnce({ id: 'cr-101', outcome: CallOutcome.NO_ANSWER })
      .mockResolvedValueOnce({ id: 'cr-102', outcome: CallOutcome.FOLLOW_UP });

    const call1 = await service.createCallOutcome(
      { studentDataId: 'sd-101', outcome: CallOutcome.NO_ANSWER },
      'advisor-1',
    );
    const call2 = await service.createCallOutcome(
      { studentDataId: 'sd-101', outcome: CallOutcome.FOLLOW_UP },
      'advisor-1',
    );

    expect(call1.id).toBe('cr-101');
    expect(call2.id).toBe('cr-102');
    expect(prismaMock.callRecord.create).toHaveBeenCalledTimes(2);
  });

  it('3 & 4. Different outcomes remain independent and notes remain attached to correct call', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: 'ACTIVE' } }],
    });

    prismaMock.callRecord.create.mockImplementation(({ data }) => Promise.resolve({ id: 'cr-xyz', ...data }));

    const call = await service.createCallOutcome(
      { studentDataId: 'sd-101', outcome: CallOutcome.WRONG_NUMBER, notes: 'Wrong person answered' },
      'advisor-1',
    );

    expect(call.outcome).toBe(CallOutcome.WRONG_NUMBER);
    expect(call.notes).toBe('Wrong person answered');
  });

  it('5. CALL_BACK_LATER is accepted and persisted', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: 'ACTIVE' } }],
    });

    prismaMock.callRecord.create.mockImplementation(({ data }) => Promise.resolve({ id: 'cr-cb', ...data }));

    const call = await service.createCallOutcome(
      { studentDataId: 'sd-101', outcome: CallOutcome.CALL_BACK_LATER, notes: 'Asked to call tomorrow afternoon' },
      'advisor-1',
    );

    expect(call.outcome).toBe(CallOutcome.CALL_BACK_LATER);
    expect(call.notes).toBe('Asked to call tomorrow afternoon');
  });

  it('6. INTERESTED is accepted and persisted', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: 'ACTIVE' } }],
    });

    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead-555', phone: '9876543210' });
    prismaMock.callRecord.create.mockImplementation(({ data }) => Promise.resolve({ id: 'cr-int', ...data }));

    const call = await service.createCallOutcome(
      { studentDataId: 'sd-101', leadId: 'lead-555', outcome: CallOutcome.INTERESTED, notes: 'Very interested in MBA' },
      'advisor-1',
    );

    expect(call.outcome).toBe(CallOutcome.INTERESTED);
    expect(call.leadId).toBe('lead-555');
  });

  it('7. Unauthorized StudentData -> ForbiddenException', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [], // Not assigned to caller
    });

    await expect(
      service.createCallOutcome(
        { studentDataId: 'sd-101', outcome: CallOutcome.FOLLOW_UP },
        'advisor-unauthorized',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prismaMock.callRecord.create).not.toHaveBeenCalled();
  });

  it('8. Invalid/nonexistent Lead -> NotFoundException', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: 'ACTIVE' } }],
    });

    prismaMock.lead.findUnique.mockResolvedValue(null);

    await expect(
      service.createCallOutcome(
        { studentDataId: 'sd-101', leadId: 'non-existent-lead', outcome: CallOutcome.INTERESTED },
        'advisor-1',
      ),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.callRecord.create).not.toHaveBeenCalled();
  });

  it('9. Lead unrelated to StudentData -> rejected (BadRequestException)', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: 'ACTIVE' } }],
    });

    // Unrelated Lead has different phone number
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead-unrelated', phone: '1112223333' });

    await expect(
      service.createCallOutcome(
        { studentDataId: 'sd-101', leadId: 'lead-unrelated', outcome: CallOutcome.INTERESTED },
        'advisor-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prismaMock.callRecord.create).not.toHaveBeenCalled();
  });

  it('10. Negative duration -> rejected (BadRequestException)', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: 'ACTIVE' } }],
    });

    await expect(
      service.createCallOutcome(
        { studentDataId: 'sd-101', outcome: CallOutcome.NOT_INTERESTED, durationSeconds: -10 },
        'advisor-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prismaMock.callRecord.create).not.toHaveBeenCalled();
  });

  it('11. endedAt before startedAt -> rejected (BadRequestException)', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-1', status: 'ACTIVE' } }],
    });

    await expect(
      service.createCallOutcome(
        {
          studentDataId: 'sd-101',
          outcome: CallOutcome.WRONG_NUMBER,
          startedAt: '2026-09-22T10:00:30Z',
          endedAt: '2026-09-22T10:00:00Z',
        },
        'advisor-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prismaMock.callRecord.create).not.toHaveBeenCalled();
  });

  it('12. createdById comes from authenticated user and cannot be spoofed', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      phone: '9876543210',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-real', status: 'ACTIVE' } }],
    });

    prismaMock.callRecord.create.mockImplementation(({ data }) => Promise.resolve({ id: 'cr-real', ...data }));

    const record = await service.createCallOutcome(
      { studentDataId: 'sd-101', outcome: CallOutcome.NO_ANSWER },
      'advisor-real',
    );

    expect(record.createdById).toBe('advisor-real');
    expect(prismaMock.callRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ createdById: 'advisor-real' }),
    });
  });

  it('13. getCallHistory fetches records ordered newest first for authorized user', async () => {
    prismaMock.studentData.findUnique.mockResolvedValue({
      id: 'sd-101',
      assignmentItems: [{ assignment: { assignedToId: 'advisor-real', status: 'ACTIVE' } }],
    });

    const mockRecords = [
      { id: 'cr-2', outcome: CallOutcome.FOLLOW_UP, createdAt: new Date() },
      { id: 'cr-1', outcome: CallOutcome.NO_ANSWER, createdAt: new Date(Date.now() - 60000) },
    ];
    prismaMock.callRecord.findMany.mockResolvedValue(mockRecords);

    const history = await service.getCallHistory('sd-101', 'advisor-real');
    expect(history).toEqual(mockRecords);
    expect(prismaMock.callRecord.findMany).toHaveBeenCalledWith({
      where: { studentDataId: 'sd-101' },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  });
});
