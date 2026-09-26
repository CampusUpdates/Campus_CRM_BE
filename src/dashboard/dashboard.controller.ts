import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('hr')
  getHRDashboardStats(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getHRDashboardStats(req.user.sub);
  }

  @Get('advisor')
  getAdvisorDashboardStats(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getAdvisorDashboardStats(req.user.sub);
  }

  @Get('manager')
  getManagerDashboardStats(
    @Req() req: AuthenticatedRequest,
    @Query('teamId') teamId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('pipelinePeriod') pipelinePeriod?: string,
    @Query('tpcPeriod') tpcPeriod?: string,
    @Query('memberPeriod') memberPeriod?: string,
  ) {
    return this.dashboardService.getManagerDashboardStats(
      req.user.sub,
      teamId,
      startDate,
      endDate,
      pipelinePeriod,
      tpcPeriod,
      memberPeriod,
    );
  }

  @Get('super-admin')
  getSuperAdminDashboardStats(
    @Req() req: AuthenticatedRequest,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('callTime') callTime?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.dashboardService.getSuperAdminDashboardStats(
      req.user.sub,
      startDate,
      endDate,
      pageNum,
      limitNum,
      callTime,
    );
  }


  @Get('admissions')
  getAdmissionsDashboardStats(
    @Req() req: AuthenticatedRequest,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('collegeId') collegeId?: string,
    @Query('course') course?: string,
    @Query('teamId') teamId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('source') source?: string,
    @Query('statusId') statusId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getAdmissionsDashboardStats(req.user.sub, {
      startDate,
      endDate,
      collegeId,
      course,
      teamId,
      employeeId,
      source,
      statusId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
    });
  }
}
