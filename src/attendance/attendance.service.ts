import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AttendancePolicyDto } from './dto/attendance-policy.dto';
import { HolidayDto } from './dto/holiday.dto';

export interface AttendanceFilterDto {
  date?: string;
  status?: string;
  teamId?: string;
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getAttendanceRecords(filters: AttendanceFilterDto) {
    const { date: dateParam, status, teamId } = filters;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let startDate = startOfToday;
    let endDate = endOfToday;

    if (dateParam && dateParam !== 'today') {
      const parsed = new Date(dateParam);
      if (!isNaN(parsed.getTime())) {
        startDate = new Date(parsed);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(parsed);
        endDate.setHours(23, 59, 59, 999);
      }
    }

    const whereClause: any = {
      date: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (status && status !== 'ALL') {
      whereClause.status = status;
    }

    if (teamId && teamId !== 'all') {
      const parsedTeamId = parseInt(teamId, 10);
      if (!isNaN(parsedTeamId)) {
        whereClause.user = {
          teamId: parsedTeamId,
        };
      }
    }

    const records = await this.prisma.attendance.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: { select: { id: true, name: true } },
            team: {
              select: {
                id: true,
                name: true,
                manager: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
        office: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return records;
  }

  // --- Policy Validation ---
  private validatePolicyTimes(dto: AttendancePolicyDto) {
    const parseTime = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    const start = parseTime(dto.officeStartTime);
    const casual = parseTime(dto.casualLeaveCutoff);
    const half = parseTime(dto.halfDayCutoff);
    const end = parseTime(dto.officeEndTime);

    if (!(start < casual && casual < half && half <= end)) {
      throw new BadRequestException(
        'Invalid policy times. Required ordering: officeStartTime < casualLeaveCutoff < halfDayCutoff <= officeEndTime',
      );
    }
  }

  // --- Policy Endpoints ---
  async getPolicy(officeId: number) {
    const policy = await this.prisma.attendancePolicy.findUnique({
      where: { officeId },
    });
    if (!policy)
      throw new NotFoundException('Policy not found for this office');
    return policy;
  }

  async updatePolicy(officeId: number, dto: AttendancePolicyDto) {
    this.validatePolicyTimes(dto);

    const policy = await this.prisma.attendancePolicy.findUnique({
      where: { officeId },
    });
    if (!policy) {
      return this.prisma.attendancePolicy.create({
        data: {
          officeId,
          ...dto,
        },
      });
    }
    return this.prisma.attendancePolicy.update({
      where: { officeId },
      data: dto,
    });
  }

  // --- Holiday Endpoints ---
  async getHolidays() {
    return this.prisma.holiday.findMany({
      orderBy: { date: 'asc' },
    });
  }

  async createHoliday(dto: HolidayDto) {
    const parsedDate = new Date(dto.date);
    parsedDate.setHours(0, 0, 0, 0);

    const existing = await this.prisma.holiday.findUnique({
      where: { date: parsedDate },
    });
    if (existing)
      throw new ConflictException('Holiday for this date already exists');

    return this.prisma.holiday.create({
      data: {
        date: parsedDate,
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
    });
  }

  async updateHoliday(id: number, dto: HolidayDto) {
    const parsedDate = new Date(dto.date);
    parsedDate.setHours(0, 0, 0, 0);

    const existingDate = await this.prisma.holiday.findUnique({
      where: { date: parsedDate },
    });
    if (existingDate && existingDate.id !== id) {
      throw new ConflictException(
        'Another holiday already exists for this date',
      );
    }

    return this.prisma.holiday.update({
      where: { id },
      data: {
        date: parsedDate,
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive,
      },
    });
  }

  async deleteHoliday(id: number) {
    return this.prisma.holiday.delete({
      where: { id },
    });
  }
}
