import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AttendanceFinalizerService {
  private readonly logger = new Logger(AttendanceFinalizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Run every day at 23:30 (11:30 PM)
  @Cron('30 23 * * *')
  async finalizeAttendance() {
    this.logger.log('Starting daily attendance finalization...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Check if today is a holiday
    const holiday = await this.prisma.holiday.findUnique({
      where: { date: today },
    });

    if (holiday && holiday.isActive) {
      this.logger.log(
        `Today is a holiday (${holiday.name}). Skipping LEAVE creation.`,
      );
      return;
    }

    // 2. Find eligible non-Super-Admin users (Active)
    const activeUsers = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: {
          name: {
            not: 'SUPER_ADMIN',
          },
        },
      },
      select: { id: true },
    });

    if (activeUsers.length === 0) {
      this.logger.log('No active users found.');
      return;
    }

    // 3. Find default office for LEAVE records
    const defaultOffice = await this.prisma.office.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });

    if (!defaultOffice) {
      this.logger.error('No active office found to assign LEAVE records.');
      return;
    }

    let leaveCount = 0;

    // 4. For each active user, attempt to create a LEAVE record if none exists
    for (const user of activeUsers) {
      try {
        // We use create with a unique constraint to ensure no race conditions
        // or overwriting of existing attendance
        await this.prisma.attendance.create({
          data: {
            userId: user.id,
            officeId: defaultOffice.id,
            date: today,
            status: 'LEAVE',
          },
        });
        leaveCount++;
      } catch (error) {
        // P2002: Unique constraint failed
        // It means they already have an attendance record for today, which is fine!
        if (error.code !== 'P2002') {
          this.logger.error(
            `Error finalizing attendance for user ${user.id}:`,
            error,
          );
        }
      }
    }

    this.logger.log(
      `Attendance finalization complete. Created ${leaveCount} LEAVE records.`,
    );
  }
}
