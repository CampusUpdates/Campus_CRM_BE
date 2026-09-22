import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('hr')
  getHRReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('department') department?: string,
  ) {
    return this.reportsService.getHRReport({
      startDate,
      endDate,
      department,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('crm')
  getCRMReport(
    @Req() req: AuthenticatedRequest,
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('collegeId') collegeId?: string,
    @Query('memberId') memberId?: string,
    @Query('statusId') statusId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reportsService.getCRMReport(req.user, {
      period,
      startDate,
      endDate,
      collegeId,
      memberId,
      statusId,
      search,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 10,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('crm/export')
  exportCRMReport(
    @Req() req: AuthenticatedRequest,
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('collegeId') collegeId?: string,
    @Query('memberId') memberId?: string,
    @Query('statusId') statusId?: string,
    @Query('search') search?: string,
  ) {
    return this.reportsService.exportCRMReport(req.user, {
      period,
      startDate,
      endDate,
      collegeId,
      memberId,
      statusId,
      search,
    });
  }
}

