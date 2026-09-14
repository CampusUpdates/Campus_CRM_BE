import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  NotificationsService,
  GetNotificationsQueryDto,
} from './notifications.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('unread-count')
  getUnreadCount(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.getUnreadCount(req.user.sub);
  }

  @Get()
  getNotifications(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: any,
    @Query('isRead') isRead?: string,
    @Query('search') search?: string,
  ) {
    const query: GetNotificationsQueryDto = {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      type,
      isRead: isRead !== undefined ? isRead === 'true' : undefined,
      search,
    };
    return this.notificationsService.getUserNotifications(req.user.sub, query);
  }

  @Patch('read-all')
  markAllAsRead(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.markAllAsRead(req.user.sub);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.notificationsService.markAsRead(req.user.sub, id);
  }

  @Delete('clear-all')
  clearAllNotifications(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.clearAllNotifications(req.user.sub);
  }

  @Delete(':id')
  deleteNotification(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notificationsService.deleteNotification(req.user.sub, id);
  }
}
