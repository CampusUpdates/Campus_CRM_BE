import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceClassificationService } from './attendance-classification.service';
import { AttendancePolicy } from '@prisma/client';

describe('AttendanceClassificationService', () => {
  let service: AttendanceClassificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AttendanceClassificationService],
    }).compile();

    service = module.get<AttendanceClassificationService>(
      AttendanceClassificationService,
    );
  });

  const mockPolicy: AttendancePolicy = {
    id: 1,
    officeId: 1,
    officeStartTime: '10:00',
    casualLeaveCutoff: '10:30',
    halfDayCutoff: '14:00',
    officeEndTime: '19:00',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createDate = (hours: number, minutes: number) => {
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  describe('Attendance Classification', () => {
    it('09:59 should be PRESENT', () => {
      expect(service.classifyAttendance(createDate(9, 59), mockPolicy)).toBe(
        'PRESENT',
      );
    });

    it('10:00 should be PRESENT', () => {
      expect(service.classifyAttendance(createDate(10, 0), mockPolicy)).toBe(
        'PRESENT',
      );
    });

    it('10:01 should be CASUAL_LEAVE', () => {
      expect(service.classifyAttendance(createDate(10, 1), mockPolicy)).toBe(
        'CASUAL_LEAVE',
      );
    });

    it('10:30 should be CASUAL_LEAVE', () => {
      expect(service.classifyAttendance(createDate(10, 30), mockPolicy)).toBe(
        'CASUAL_LEAVE',
      );
    });

    it('10:31 should be HALF_DAY', () => {
      expect(service.classifyAttendance(createDate(10, 31), mockPolicy)).toBe(
        'HALF_DAY',
      );
    });

    it('13:59 should be HALF_DAY', () => {
      expect(service.classifyAttendance(createDate(13, 59), mockPolicy)).toBe(
        'HALF_DAY',
      );
    });

    it('14:00 should be HALF_DAY', () => {
      expect(service.classifyAttendance(createDate(14, 0), mockPolicy)).toBe(
        'HALF_DAY',
      );
    });

    it('14:01 should be HALF_DAY', () => {
      expect(service.classifyAttendance(createDate(14, 1), mockPolicy)).toBe(
        'HALF_DAY',
      );
    });

    it('15:00 should be HALF_DAY', () => {
      expect(service.classifyAttendance(createDate(15, 0), mockPolicy)).toBe(
        'HALF_DAY',
      );
    });

    it('19:00 should be HALF_DAY', () => {
      expect(service.classifyAttendance(createDate(19, 0), mockPolicy)).toBe(
        'HALF_DAY',
      );
    });
  });
});
