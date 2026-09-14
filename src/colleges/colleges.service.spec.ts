import { Test, TestingModule } from '@nestjs/testing';
import { CollegesService } from './colleges.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { NotFoundException } from '@nestjs/common';
import { ActivityType } from '@prisma/client';

describe('CollegesService', () => {
  let service: CollegesService;
  let prismaService: any;
  let activityLogService: any;

  const mockCollege = {
    id: 'college-uuid-1',
    name: 'ABC University',
    description: 'Test Description',
    isActive: true,
    hasTieUp: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prismaService = {
      college: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      lead: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      leadCollege: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      course: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      collegeCompetitor: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((cb) => cb(prismaService)),
    };

    activityLogService = {
      createLog: jest.fn().mockResolvedValue({ id: 'log-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollegesService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
        { provide: ActivityLogService, useValue: activityLogService },
      ],
    }).compile();

    service = module.get<CollegesService>(CollegesService);
  });

  it('1. findAllActive filters by isActive: true', async () => {
    prismaService.college.findMany.mockResolvedValue([mockCollege]);
    const result = await service.findAllActive({ search: 'ABC' });
    expect(prismaService.college.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        isActive: true,
      }),
      include: expect.any(Object),
      orderBy: expect.any(Object),
    });
    expect(result).toEqual([mockCollege]);
  });

  it('2. findAllManagement returns all colleges including inactive ones', async () => {
    prismaService.college.findMany.mockResolvedValue([
      mockCollege,
      { ...mockCollege, id: 'col-2', isActive: false },
    ]);
    const result = await service.findAllManagement();
    expect(prismaService.college.findMany).toHaveBeenCalledWith({
      where: {},
      include: expect.any(Object),
      orderBy: expect.any(Object),
    });
    expect(result).toHaveLength(2);
  });

  it('3. updateStatus toggles status and logs activity', async () => {
    prismaService.college.findUnique.mockResolvedValue(mockCollege);
    prismaService.college.update.mockResolvedValue({
      ...mockCollege,
      isActive: false,
    });

    const result = await service.updateStatus(
      'college-uuid-1',
      false,
      'user-1',
    );

    expect(prismaService.college.update).toHaveBeenCalledWith({
      where: { id: 'college-uuid-1' },
      data: { isActive: false },
    });
    expect(activityLogService.createLog).toHaveBeenCalledWith({
      userId: 'user-1',
      activity: ActivityType.COLLEGE,
      entityType: 'COLLEGE',
      entityId: 'college-uuid-1',
      description: 'College ABC University deactivated',
    });
    expect(result.isActive).toBe(false);
  });

  it('4. remove permanently deletes college and logs activity before deletion', async () => {
    prismaService.college.findUnique.mockResolvedValue(mockCollege);
    prismaService.college.delete.mockResolvedValue(mockCollege);

    const result = await service.remove('college-uuid-1', 'user-1');

    expect(activityLogService.createLog).toHaveBeenCalledWith({
      userId: 'user-1',
      activity: ActivityType.COLLEGE,
      entityType: 'COLLEGE',
      entityId: 'college-uuid-1',
      description: 'College ABC University permanently deleted',
    });
    expect(prismaService.college.delete).toHaveBeenCalledWith({
      where: { id: 'college-uuid-1' },
    });
    expect(result).toEqual({ message: 'College permanently deleted' });
  });

  it('5. updateStatus throws NotFoundException if college does not exist', async () => {
    prismaService.college.findUnique.mockResolvedValue(null);
    await expect(
      service.updateStatus('non-existent', true, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });
});
