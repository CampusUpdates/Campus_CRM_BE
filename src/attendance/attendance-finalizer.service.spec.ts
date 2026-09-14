import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceFinalizerService } from './attendance-finalizer.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { Logger } from '@nestjs/common';

jest.mock('@nestjs/schedule', () => ({
  Cron: () => jest.fn(),
  CronExpression: {},
}));

describe('AttendanceFinalizerService', () => {
  let service: AttendanceFinalizerService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceFinalizerService,
        {
          provide: PrismaService,
          useValue: {
            holiday: {
              findUnique: jest.fn(),
            },
            user: {
              findMany: jest.fn(),
            },
            office: {
              findFirst: jest.fn(),
            },
            attendance: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AttendanceFinalizerService>(AttendanceFinalizerService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('finalizeAttendance', () => {
    it('should skip LEAVE creation if today is an active holiday', async () => {
      (prisma.holiday.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        date: new Date(),
        name: 'Public Holiday',
        isActive: true,
      });

      await service.finalizeAttendance();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.attendance.create).not.toHaveBeenCalled();
    });

    it('should create LEAVE for active users if no holiday and they have no attendance', async () => {
      (prisma.holiday.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'user-1' }]);
      (prisma.office.findFirst as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.attendance.create as jest.Mock).mockResolvedValue({});

      await service.finalizeAttendance();
      expect(prisma.attendance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          officeId: 1,
          status: 'LEAVE',
        }),
      });
    });

    it('should handle duplicate creation races safely (P2002)', async () => {
      (prisma.holiday.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'user-1' }]);
      (prisma.office.findFirst as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.attendance.create as jest.Mock).mockRejectedValue({ code: 'P2002' });

      // Should not throw
      await expect(service.finalizeAttendance()).resolves.not.toThrow();
    });
  });
});
