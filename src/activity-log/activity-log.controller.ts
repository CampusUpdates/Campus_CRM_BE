import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { QueryActivityLogDto } from './dto/query-activity-log.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

@Controller('activity-logs')
@UseGuards(JwtAuthGuard)
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: QueryActivityLogDto,
  ) {
    return this.activityLogService.findAll(
      query,
      req.user.sub,
      req.user.roleId,
    );
  }
}
