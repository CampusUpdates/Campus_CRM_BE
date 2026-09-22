import {
  Controller,
  Get,
  Query,
  UseGuards,
  Param,
  ParseIntPipe,
  Body,
  Put,
  Post,
  Delete,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions/permissions.guard';
import { Permissions } from 'src/permissions/permissions.decorator';
import { AttendancePolicyDto } from './dto/attendance-policy.dto';
import { HolidayDto } from './dto/holiday.dto';

import { Req } from '@nestjs/common';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @UseGuards(PermissionsGuard)
  @Permissions('ATTENDANCE_MANAGE')
  @Get()
  getAttendanceRecords(
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('teamId') teamId?: string,
    @Query('roleId') roleId?: string,
    @Query('role') role?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.attendanceService.getAttendanceRecords({
      date,
      startDate,
      endDate,
      userId,
      search,
      status,
      teamId,
      roleId,
      role,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('check-out')
  checkOut(@Req() req: AuthenticatedRequest) {
    return this.attendanceService.checkOut(req.user.sub);
  }

  // --- Policy Endpoints ---
  @UseGuards(PermissionsGuard)
  @Permissions('MANAGE_ATTENDANCE_POLICY')
  @Get('policy/:officeId')
  getPolicy(@Param('officeId', ParseIntPipe) officeId: number) {
    return this.attendanceService.getPolicy(officeId);
  }

  @UseGuards(PermissionsGuard)
  @Permissions('MANAGE_ATTENDANCE_POLICY')
  @Put('policy/:officeId')
  updatePolicy(
    @Param('officeId', ParseIntPipe) officeId: number,
    @Body() dto: AttendancePolicyDto,
  ) {
    return this.attendanceService.updatePolicy(officeId, dto);
  }

  // --- Holiday Endpoints ---
  @UseGuards(PermissionsGuard)
  @Permissions('MANAGE_HOLIDAYS')
  @Get('holidays')
  getHolidays() {
    return this.attendanceService.getHolidays();
  }

  @UseGuards(PermissionsGuard)
  @Permissions('MANAGE_HOLIDAYS')
  @Post('holidays')
  createHoliday(@Body() dto: HolidayDto) {
    return this.attendanceService.createHoliday(dto);
  }

  @UseGuards(PermissionsGuard)
  @Permissions('MANAGE_HOLIDAYS')
  @Put('holidays/:id')
  updateHoliday(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HolidayDto,
  ) {
    return this.attendanceService.updateHoliday(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @Permissions('MANAGE_HOLIDAYS')
  @Delete('holidays/:id')
  deleteHoliday(@Param('id', ParseIntPipe) id: number) {
    return this.attendanceService.deleteHoliday(id);
  }
}
