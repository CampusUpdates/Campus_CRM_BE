import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceService } from './attendance.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let prisma: PrismaService;

  const mockPrismaService = {
    attendance: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAttendanceRecords', () => {
    it('should retrieve workforce attendance records and return summary counts', async () => {
      const mockRecords = [
        {
          id: 'att-1',
          userId: 'user-1',
          officeId: 1,
          date: new Date('2026-09-15T00:00:00.000Z'),
          checkIn: new Date('2026-09-15T09:30:00.000Z'),
          checkOut: new Date('2026-09-15T18:00:00.000Z'),
          status: 'PRESENT',
          createdAt: new Date(),
          updatedAt: new Date(),
          user: {
            id: 'user-1',
            firstName: 'Alice',
            lastName: 'Advisor',
            email: 'alice@example.com',
            phone: '1234567890',
            role: { id: 2, name: 'Program Advisor' },
            team: { id: 1, name: 'Team Alpha', manager: { id: 'mgr-1', firstName: 'Manager', lastName: 'One' } },
          },
          office: { id: 1, name: 'HQ Office' },
        },
      ];

      mockPrismaService.attendance.findMany.mockResolvedValue(mockRecords);
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getAttendanceRecords({ date: '2026-09-15' });

      expect(result).toHaveProperty('records');
      expect(result).toHaveProperty('summary');
      expect(result.summary.total).toBe(1);
      expect(result.summary.present).toBe(1);
      expect(result.records[0].workingHours).toBe('8 hrs 30 mins');
    });

    it('should calculate workingHours as "Ongoing" when checkOut is null', async () => {
      const mockRecords = [
        {
          id: 'att-2',
          userId: 'user-2',
          officeId: 1,
          date: new Date('2026-09-15T00:00:00.000Z'),
          checkIn: new Date('2026-09-15T09:30:00.000Z'),
          checkOut: null,
          status: 'PRESENT',
          createdAt: new Date(),
          updatedAt: new Date(),
          user: {
            id: 'user-2',
            firstName: 'Bob',
            lastName: 'Advisor',
            role: { id: 2, name: 'Program Advisor' },
            team: null,
          },
          office: { id: 1, name: 'HQ Office' },
        },
      ];

      mockPrismaService.attendance.findMany.mockResolvedValue(mockRecords);
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getAttendanceRecords({ date: '2026-09-15' });
      expect(result.records[0].workingHours).toBe('Ongoing');
    });

    it('should filter by teamId and roleId', async () => {
      mockPrismaService.attendance.findMany.mockResolvedValue([]);
      mockPrismaService.user.findMany.mockResolvedValue([]);

      await service.getAttendanceRecords({
        date: '2026-09-15',
        teamId: '1',
        roleId: '2',
        status: 'PRESENT',
      });

      expect(mockPrismaService.attendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PRESENT',
            user: expect.objectContaining({
              teamId: 1,
              roleId: 2,
            }),
          }),
        }),
      );
    });
  });

  describe('checkOut', () => {
    it('should successfully update checkOut timestamp on existing attendance record', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const existingRecord = {
        id: 'att-100',
        userId: 'user-10',
        officeId: 1,
        date: today,
        checkIn: new Date(Date.now() - 4 * 3600 * 1000), // 4 hours ago
        checkOut: null,
        status: 'PRESENT',
      };

      mockPrismaService.attendance.findFirst.mockResolvedValue(existingRecord);
      mockPrismaService.attendance.update.mockImplementation(({ data }) =>
        Promise.resolve({
          ...existingRecord,
          checkOut: data.checkOut,
          user: { id: 'user-10', firstName: 'User', lastName: 'Ten', role: { id: 2, name: 'Advisor' } },
          office: { id: 1, name: 'HQ' },
        }),
      );

      const result = await service.checkOut('user-10');

      expect(result.checkOut).toBeDefined();
      expect(result.workingHours).toContain('hrs');
    });

    it('should throw NotFoundException if no check-in record exists for today', async () => {
      mockPrismaService.attendance.findFirst.mockResolvedValue(null);

      await expect(service.checkOut('user-999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if user has already checked out', async () => {
      mockPrismaService.attendance.findFirst.mockResolvedValue({
        id: 'att-101',
        userId: 'user-11',
        checkIn: new Date(),
        checkOut: new Date(),
      });

      await expect(service.checkOut('user-11')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
