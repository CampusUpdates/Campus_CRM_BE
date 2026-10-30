import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';
import { CounsellingService } from './counselling.service';
import { CreateCounsellingDto } from './dto/create-counselling.dto';
import { CompleteCounsellingDto } from './dto/complete-counselling.dto';
import { ScheduleCounsellingDto } from './dto/schedule-counselling.dto';
import { CounsellingStatus } from '@prisma/client';

@Controller()
@UseGuards(JwtAuthGuard)
export class CounsellingController {
  constructor(private readonly counsellingService: CounsellingService) {}

  @Get(['counselling/pending', 'api/v1/counselling/pending'])
  getPending(@Req() req: AuthenticatedRequest) {
    return this.counsellingService.getPendingCounsellingRequests(req.user.sub);
  }

  @Get(['counselling', 'api/v1/counselling'])
  getAll(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('time') time?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.counsellingService.getAllCounsellingRequests(req.user.sub, {
      status,
      time,
      fromDate,
      toDate,
      page,
      limit,
    });
  }

  @Post(['leads/:leadId/counselling', 'api/v1/leads/:leadId/counselling'])
  create(
    @Param('leadId') leadId: string,
    @Body() dto: CreateCounsellingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.counsellingService.createCounsellingRequests(
      req.user.sub,
      leadId,
      dto,
    );
  }

  @Get(['leads/:leadId/counselling', 'api/v1/leads/:leadId/counselling'])
  findByLead(
    @Param('leadId') leadId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.counsellingService.getCounsellingRequestsByLead(
      req.user.sub,
      leadId,
    );
  }

  @Post(['counselling/:id/schedule', 'api/v1/counselling/:id/schedule'])
  schedule(
    @Param('id') id: string,
    @Body() dto: ScheduleCounsellingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.counsellingService.scheduleCounsellingRequest(
      req.user.sub,
      id,
      dto,
    );
  }

  @Post(['counselling/:id/complete', 'api/v1/counselling/:id/complete'])
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteCounsellingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.counsellingService.completeCounsellingRequest(
      req.user.sub,
      id,
      dto,
    );
  }
}
