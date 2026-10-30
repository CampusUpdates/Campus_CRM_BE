import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
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

  @Sse('stream')
  stream(@Req() req: AuthenticatedRequest): Observable<MessageEvent> {
    return this.notificationsService.getUserStream(req.user.sub);
  }

  @Get('unread-count')
  getUnreadCount(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.getUnreadCount(req.user.sub);
  }

  @Get('sidebar-indicators')
  getSidebarIndicators(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.getSidebarIndicators(req.user.sub);
  }

  @Post('module-seen')
  markModuleSeen(
    @Body('module') module: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notificationsService.markModuleSeen(req.user.sub, module);
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
