import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { ActivityType } from '@prisma/client';
import { CreateCollegeDto } from './dto/create-college.dto';
import { UpdateCollegeDto } from './dto/update-college.dto';

@Injectable()
export class CollegesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly activityLogService: ActivityLogService,
  ) {}

  async create(createCollegeDto: CreateCollegeDto) {
    const existingCollege = await this.prisma.college.findUnique({
      where: { name: createCollegeDto.name },
    });

    if (existingCollege) {
      throw new ConflictException('College with this name already exists');
    }

    return this.prisma.college.create({
      data: createCollegeDto,
    });
  }

  async findAllActive(query?: {
    search?: string;
    hasTieUp?: string;
    state?: string;
    city?: string;
  }) {
    return this.findAllManagement({
      ...query,
      isActive: 'true',
    });
  }

  async findAllManagement(query?: {
    search?: string;
    isActive?: string;
    hasTieUp?: string;
    state?: string;
    city?: string;
  }) {
    const where: any = {};

    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
        { state: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query?.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query?.hasTieUp !== undefined) {
      where.hasTieUp = query.hasTieUp === 'true';
    }

    if (query?.state) {
      where.state = { contains: query.state, mode: 'insensitive' };
    }

    if (query?.city) {
      where.city = { contains: query.city, mode: 'insensitive' };
    }

    return this.prisma.college.findMany({
      where,
      include: {
        _count: {
          select: {
            courses: true,
            leadApplications: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const college = await this.prisma.college.findUnique({
      where: { id },
      include: {
        courses: true,
        approvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
          },
        },
        competitors: {
          include: {
            competitorCollege: true,
          },
        },
        _count: {
          select: {
            leadApplications: true,
          },
        },
      },
    });

    if (!college) {
      throw new NotFoundException('College not found');
    }

    return college;
  }

  async update(id: string, updateCollegeDto: UpdateCollegeDto) {
    const college = await this.prisma.college.findUnique({
      where: { id },
    });

    if (!college) {
      throw new NotFoundException('College not found');
    }

    if (updateCollegeDto.name && updateCollegeDto.name !== college.name) {
      const existing = await this.prisma.college.findUnique({
        where: { name: updateCollegeDto.name },
      });
      if (existing) {
        throw new ConflictException('College with this name already exists');
      }
    }

    return this.prisma.college.update({
      where: { id },
      data: updateCollegeDto,
    });
  }

  async updateStatus(id: string, isActive: boolean, userId: string) {
    const college = await this.prisma.college.findUnique({
      where: { id },
    });

    if (!college) {
      throw new NotFoundException('College not found');
    }

    const updated = await this.prisma.college.update({
      where: { id },
      data: { isActive },
    });

    await this.activityLogService.createLog({
      userId,
      activity: ActivityType.COLLEGE,
      entityType: 'COLLEGE',
      entityId: id,
      description: `College ${college.name} ${isActive ? 'activated' : 'deactivated'}`,
    });

    return updated;
  }

  async approve(id: string, userId: string) {
    const college = await this.prisma.college.findUnique({
      where: { id },
    });

    if (!college) {
      throw new NotFoundException('College not found');
    }

    const updated = await this.prisma.college.update({
      where: { id },
      data: {
        isActive: true,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });

    await this.activityLogService.createLog({
      userId,
      activity: ActivityType.COLLEGE,
      entityType: 'COLLEGE',
      entityId: id,
      description: `College ${college.name} activated`,
    });

    await this.notificationsService.createNotification({
      title: 'College Approved',
      message: `College ${college.name} has been approved.`,
      type: 'SYSTEM',
      recipientUserIds: [userId],
    });

    return updated;
  }

  async remove(id: string, userId?: string) {
    const college = await this.prisma.college.findUnique({
      where: { id },
    });

    if (!college) {
      throw new NotFoundException('College not found');
    }

    if (userId) {
      await this.activityLogService.createLog({
        userId,
        activity: ActivityType.COLLEGE,
        entityType: 'COLLEGE',
        entityId: id,
        description: `College ${college.name} permanently deleted`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Unlink leads having this college as final college (set finalCollegeId = null)
      await tx.lead.updateMany({
        where: { finalCollegeId: id },
        data: { finalCollegeId: null },
      });

      // 2. Delete college applications (and dependent interviews/payments/letters/history)
      await tx.leadCollege.deleteMany({
        where: { collegeId: id },
      });

      // 3. Delete college courses
      await tx.course.deleteMany({
        where: { collegeId: id },
      });

      // 4. Delete college competitor associations
      await tx.collegeCompetitor.deleteMany({
        where: {
          OR: [{ collegeId: id }, { competitorCollegeId: id }],
        },
      });

      // 5. Delete the college record itself
      await tx.college.delete({
        where: { id },
      });
    });

    return { message: 'College permanently deleted' };
  }
}
