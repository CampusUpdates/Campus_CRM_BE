import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AttendancePolicyDto } from './dto/attendance-policy.dto';
import { HolidayDto } from './dto/holiday.dto';
import { AttendanceFilterDto } from './dto/attendance-filter.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  // Helper method to compute working duration string
  private calculateWorkingHours(
    checkIn?: Date | null,
    checkOut?: Date | null,
  ): string | null {
    if (!checkIn) return null;
    if (!checkOut) return 'Ongoing';
    const diffMs = checkOut.getTime() - checkIn.getTime();
    if (diffMs <= 0) return '0 hrs 0 mins';
    const totalMins = Math.floor(diffMs / (1000 * 60));
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return `${hrs} hrs ${mins} mins`;
  }

  async getAttendanceRecords(filters: AttendanceFilterDto) {
    const {
      date: dateParam,
      startDate: startDateParam,
      endDate: endDateParam,
      userId: userIdParam,
      search: searchParam,
      status,
      teamId,
      roleId,
      role: roleParam,
      page,
      limit,
    } = filters;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let startDate = startOfToday;
    let endDate = endOfToday;
    let isTodayQuery = true;

    if (startDateParam && endDateParam) {
      const pStart = new Date(startDateParam);
      const pEnd = new Date(endDateParam);
      if (!isNaN(pStart.getTime()) && !isNaN(pEnd.getTime())) {
        startDate = new Date(pStart);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(pEnd);
        endDate.setHours(23, 59, 59, 999);
        isTodayQuery =
          startDate.getTime() <= startOfToday.getTime() &&
          endOfToday.getTime() <= endDate.getTime();
      }
    } else if (dateParam && dateParam !== 'today') {
      const parsed = new Date(dateParam);
      if (!isNaN(parsed.getTime())) {
        startDate = new Date(parsed);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(parsed);
        endDate.setHours(23, 59, 59, 999);

        // Check if parsed date matches today
        isTodayQuery = startDate.getTime() === startOfToday.getTime();
      }
    }

    // Build user filter clause
    const userWhere: any = {
      status: 'ACTIVE',
      role: {
        name: {
          not: 'SUPER_ADMIN',
        },
      },
    };

    if (userIdParam) {
      userWhere.id = userIdParam;
    }

    if (teamId && teamId !== 'all') {
      const parsedTeamId = parseInt(teamId, 10);
      if (!isNaN(parsedTeamId)) {
        userWhere.teamId = parsedTeamId;
      }
    }

    if (roleId && roleId !== 'all') {
      const parsedRoleId = parseInt(roleId, 10);
      if (!isNaN(parsedRoleId)) {
        userWhere.roleId = parsedRoleId;
      }
    }

    if (roleParam && roleParam !== 'all') {
      userWhere.role = {
        name: roleParam,
      };
    }

    if (searchParam && searchParam.trim().length > 0) {
      const q = searchParam.trim();
      userWhere.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Where clause for existing Attendance records
    const attendanceWhere: any = {
      date: {
        gte: startDate,
        lte: endDate,
      },
      user: userWhere,
    };

    if (status && status !== 'ALL') {
      attendanceWhere.status = status;
    }

    // Query existing DB attendance records with full relations
    const rawDbRecords = await this.prisma.attendance.findMany({
      where: attendanceWhere,
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

    let combinedRecords: Array<{
      id: string;
      userId: string;
      officeId: number;
      date: Date;
      checkIn: Date | null;
      checkOut: Date | null;
      status: any;
      workingHours: string | null;
      createdAt: Date;
      updatedAt: Date;
      user: any;
      office: any | null;
    }> = rawDbRecords.map((rec) => ({
      ...rec,
      workingHours: this.calculateWorkingHours(rec.checkIn, rec.checkOut),
    }));

    // If querying today (or dates before finalizer ran), include active workforce members who haven't checked in yet
    if (isTodayQuery) {
      const activeWorkforce = await this.prisma.user.findMany({
        where: userWhere,
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
      });

      const recordedUserIds = new Set(rawDbRecords.map((r) => r.userId));

      const unCheckedInUsers = activeWorkforce.filter(
        (u) => !recordedUserIds.has(u.id),
      );

      // Synthesize ABSENT records for un-checked-in employees
      const synthesizedAbsentRecords = unCheckedInUsers.map((u) => ({
        id: `virtual-absent-${u.id}-${startDate.toISOString().slice(0, 10)}`,
        userId: u.id,
        officeId: 0,
        date: startDate,
        checkIn: null,
        checkOut: null,
        status: 'ABSENT' as const,
        workingHours: null,
        createdAt: startDate,
        updatedAt: startDate,
        user: u,
        office: null,
      }));

      if (!status || status === 'ALL' || status === 'ABSENT') {
        combinedRecords = [...combinedRecords, ...synthesizedAbsentRecords];
      }
    }

    // Sort by checkIn time desc (or user name asc)
    combinedRecords.sort((a, b) => {
      if (a.checkIn && b.checkIn) {
        return b.checkIn.getTime() - a.checkIn.getTime();
      }
      if (a.checkIn) return -1;
      if (b.checkIn) return 1;
      return a.user.firstName.localeCompare(b.user.firstName);
    });

    // Compute summary counts across filtered scope
    const totalCount = combinedRecords.length;
    const presentCount = combinedRecords.filter(
      (r) => r.status === 'PRESENT',
    ).length;
    const absentCount = combinedRecords.filter(
      (r) => r.status === 'ABSENT',
    ).length;
    const halfDayCount = combinedRecords.filter(
      (r) => r.status === 'HALF_DAY',
    ).length;
    const leaveCount = combinedRecords.filter(
      (r) => r.status === 'LEAVE',
    ).length;
    const casualLeaveCount = combinedRecords.filter(
      (r) => r.status === 'CASUAL_LEAVE',
    ).length;

    // Apply pagination if specified
    let paginatedRecords = combinedRecords;
    if (page && limit) {
      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.max(1, Number(limit));
      const startIndex = (pageNum - 1) * limitNum;
      paginatedRecords = combinedRecords.slice(
        startIndex,
        startIndex + limitNum,
      );
    }

    return {
      records: paginatedRecords,
      summary: {
        total: totalCount,
        present: presentCount,
        absent: absentCount,
        halfDay: halfDayCount,
        leave: leaveCount,
        casualLeave: casualLeaveCount,
      },
    };
  }

  // --- Check-Out Endpoint ---
  async checkOut(userId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const attendanceRecord = await this.prisma.attendance.findFirst({
      where: {
        userId,
        date: {
          gte: startOfToday,
          lte: endOfToday,
        },
      },
    });

    if (!attendanceRecord) {
      throw new NotFoundException(
        'No check-in record found for today. You must check in before checking out.',
      );
    }

    if (attendanceRecord.checkOut) {
      throw new ConflictException(
        'You have already checked out for today.',
      );
    }

    const checkOutTime = new Date();

    const updatedRecord = await this.prisma.attendance.update({
      where: { id: attendanceRecord.id },
      data: {
        checkOut: checkOutTime,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: { select: { id: true, name: true } },
          },
        },
        office: true,
      },
    });

    return {
      ...updatedRecord,
      workingHours: this.calculateWorkingHours(
        updatedRecord.checkIn,
        updatedRecord.checkOut,
      ),
    };
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
