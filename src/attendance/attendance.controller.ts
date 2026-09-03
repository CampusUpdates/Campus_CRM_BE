import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get()
  getAttendanceRecords(
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('teamId') teamId?: string,
  ) {
    return this.attendanceService.getAttendanceRecords({ date, status, teamId });
  }
}
