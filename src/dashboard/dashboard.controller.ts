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
  ) {
    return this.dashboardService.getManagerDashboardStats(
      req.user.sub,
      teamId,
      startDate,
      endDate,
    );
  }

  @Get('super-admin')
  getSuperAdminDashboardStats(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getSuperAdminDashboardStats(req.user.sub);
  }
}
