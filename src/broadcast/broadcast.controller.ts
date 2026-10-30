import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { BroadcastService } from './broadcast.service';
import {
  CreateBroadcastDto,
  PreviewRecipientsDto,
  QueryBroadcastDto,
  QueryRecipientsDto,
} from './dto/broadcast.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions/permissions.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('broadcasts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  /**
   * Preview resolved recipient count and employee list before sending (SUPER_ADMIN, MANAGER).
   */
  @Post('recipients/preview')
  async previewRecipients(
    @Body() dto: PreviewRecipientsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const role = (req.user.roleName || '').toUpperCase();
    const isSuperAdmin = role === 'SUPER_ADMIN';
    const isManager = role.includes('MANAGER');

    if (!isSuperAdmin && !isManager) {
      throw new ForbiddenException('Only Super Admin and Managers can preview broadcast recipients');
    }
    const managerId = isManager && !isSuperAdmin ? req.user.sub : undefined;
    return this.broadcastService.previewRecipients(dto, managerId);
  }

  /**
   * Create and send a broadcast message (SUPER_ADMIN, MANAGER).
   */
  @Post()
  async createBroadcast(
    @Body() dto: CreateBroadcastDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const role = (req.user.roleName || '').toUpperCase();
    const isSuperAdmin = role === 'SUPER_ADMIN';
    const isManager = role.includes('MANAGER');

    if (!isSuperAdmin && !isManager) {
      throw new ForbiddenException('Only Super Admin and Managers can create broadcast announcements');
    }
    const managerId = isManager && !isSuperAdmin ? req.user.sub : undefined;
    return this.broadcastService.createBroadcast(dto, req.user.sub, managerId);
  }

  /**
   * List broadcasts visible to current user:
   * - Super Admin sees all broadcast announcements across the CRM with summary metrics.
   * - Managers see broadcasts they sent within their scope, or their employee inbox.
   * - Employees see announcements targeted to them with individual read/ack status.
   */
  @Get()
  async getBroadcasts(
    @Query() query: QueryBroadcastDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const role = (req.user.roleName || '').toUpperCase();
    const isSuperAdmin = role === 'SUPER_ADMIN';
    const isManager = role.includes('MANAGER');
    const isInbox =
      query.inbox === true ||
      query.inbox === 'true' ||
      query.inbox === '1';

    return this.broadcastService.getBroadcasts(
      query,
      req.user.sub,
      isSuperAdmin,
      isManager,
      isInbox,
    );
  }

  /**
   * Get broadcast details.
   */
  @Get(':id')
  async getBroadcastById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const role = (req.user.roleName || '').toUpperCase();
    const isSuperAdmin = role === 'SUPER_ADMIN';
    const isManager = role.includes('MANAGER');
    return this.broadcastService.getBroadcastById(id, req.user.sub, isSuperAdmin, isManager);
  }

  /**
   * Record that the current recipient has read the message.
   * Opening a message does not acknowledge it.
   */
  @Post(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.broadcastService.markAsRead(id, req.user.sub);
  }

  /**
   * Explicitly acknowledge the message ("I Acknowledge").
   */
  @Post(':id/acknowledge')
  async acknowledge(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.broadcastService.acknowledge(id, req.user.sub);
  }

  /**
   * Acknowledgement tracking report (restricted to SUPER_ADMIN and creating MANAGER).
   */
  @Get(':id/recipients')
  async getRecipientsReport(
    @Param('id') id: string,
    @Query() query: QueryRecipientsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const role = (req.user.roleName || '').toUpperCase();
    const isSuperAdmin = role === 'SUPER_ADMIN';
    const isManager = role.includes('MANAGER');

    if (!isSuperAdmin && !isManager) {
      throw new ForbiddenException('Only Super Admin and Managers can view recipient tracking reports');
    }
    return this.broadcastService.getRecipientsReport(id, query, req.user.sub, isSuperAdmin);
  }

  /**
   * Export recipient tracking report to CSV (SUPER_ADMIN and creating MANAGER).
   */
  @Get(':id/recipients/export')
  @Header('Content-Type', 'text/csv')
  async exportRecipients(
    @Param('id') id: string,
    @Query() query: QueryRecipientsDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const role = (req.user.roleName || '').toUpperCase();
    const isSuperAdmin = role === 'SUPER_ADMIN';
    const isManager = role.includes('MANAGER');

    if (!isSuperAdmin && !isManager) {
      throw new ForbiddenException('Only Super Admin and Managers can export recipient tracking reports');
    }
    const csvData = await this.broadcastService.exportRecipientsCsv(
      id,
      query,
      req.user.sub,
      isSuperAdmin,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="broadcast_${id}_acknowledgements.csv"`,
    );
    res.send(csvData);
  }
}
