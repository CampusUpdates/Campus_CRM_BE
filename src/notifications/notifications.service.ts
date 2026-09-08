import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationType } from '@prisma/client';

export interface CreateNotificationDto {
  title: string;
  message: string;
  type: NotificationType;
  recipientUserIds: string[];
}

export interface GetNotificationsQueryDto {
  page?: number;
  limit?: number;
  type?: NotificationType;
  isRead?: boolean;
  search?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates 1 Notification record and 1 NotificationRecipient record per recipient.
   * Participates in an optional transaction (`tx`).
   */
  async createNotification(dto: CreateNotificationDto, tx?: any) {
    const prisma = tx || this.prisma;

    const uniqueRecipientIds = Array.from(new Set(dto.recipientUserIds)).filter(
      Boolean,
    );

    if (uniqueRecipientIds.length === 0) {
      return null;
    }

    // Idempotency / Duplicate Prevention:
    // If an identical notification (same title, message, type, recipient) was created within 30s, reuse or skip.
    const cutoff = new Date(Date.now() - 30 * 1000);
    const existingRecent = await prisma.notificationRecipient.findFirst({
      where: {
        userId: { in: uniqueRecipientIds },
        createdAt: { gte: cutoff },
        notification: {
          title: dto.title,
          message: dto.message,
          type: dto.type,
        },
      },
      include: {
        notification: true,
      },
    });

    if (existingRecent) {
      return existingRecent.notification;
    }

    const notification = await prisma.notification.create({
      data: {
        title: dto.title,
        message: dto.message,
        type: dto.type,
        recipients: {
          create: uniqueRecipientIds.map((userId) => ({
            userId,
            isRead: false,
          })),
        },
      },
      include: {
        recipients: true,
      },
    });

    return notification;
  }

  /**
   * Helper to create notification for a single recipient user.
   */
  async createNotificationForUser(
    userId: string,
    data: { title: string; message: string; type: NotificationType },
    tx?: any,
  ) {
    return this.createNotification(
      {
        ...data,
        recipientUserIds: [userId],
      },
      tx,
    );
  }

  /**
   * Helper to create notification for multiple recipient users.
   */
  async createNotificationForUsers(
    userIds: string[],
    data: { title: string; message: string; type: NotificationType },
    tx?: any,
  ) {
    return this.createNotification(
      {
        ...data,
        recipientUserIds: userIds,
      },
      tx,
    );
  }

  /**
   * Gets paginated and filtered notifications for the authenticated user.
   */
  async getUserNotifications(userId: string, query?: GetNotificationsQueryDto) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      userId,
    };

    if (query?.type) {
      where.notification = {
        type: query.type,
      };
    }

    if (query?.isRead !== undefined) {
      where.isRead = query.isRead;
    }

    if (query?.search) {
      where.notification = {
        ...(where.notification || {}),
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { message: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.notificationRecipient.findMany({
        where,
        include: {
          notification: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.notificationRecipient.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: items.map((recipient) => ({
        id: recipient.id,
        notificationId: recipient.notificationId,
        title: recipient.notification.title,
        message: recipient.notification.message,
        type: recipient.notification.type,
        isRead: recipient.isRead,
        readAt: recipient.readAt,
        createdAt: recipient.createdAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  /**
   * Gets total unread notification count for the authenticated user.
   */
  async getUnreadCount(userId: string) {
    const count = await this.prisma.notificationRecipient.count({
      where: {
        userId,
        isRead: false,
      },
    });

    return { count };
  }

  /**
   * Marks a single NotificationRecipient as read for the authenticated user.
   */
  async markAsRead(userId: string, recipientId: string) {
    const recipient = await this.prisma.notificationRecipient.findUnique({
      where: { id: recipientId },
    });

    if (!recipient || recipient.userId !== userId) {
      throw new NotFoundException('Notification not found or access denied');
    }

    if (recipient.isRead) {
      return { success: true, message: 'Notification already marked as read' };
    }

    await this.prisma.notificationRecipient.update({
      where: { id: recipientId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { success: true, message: 'Notification marked as read' };
  }

  /**
   * Marks all NotificationRecipient records as read for the authenticated user.
   */
  async markAllAsRead(userId: string) {
    await this.prisma.notificationRecipient.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { success: true, message: 'All notifications marked as read' };
  }

  /**
   * Deletes a NotificationRecipient record for the authenticated user.
   * Safe: Does not delete other recipients' records.
   */
  async deleteNotification(userId: string, recipientId: string) {
    const recipient = await this.prisma.notificationRecipient.findUnique({
      where: { id: recipientId },
    });

    if (!recipient || recipient.userId !== userId) {
      throw new NotFoundException('Notification not found or access denied');
    }

    await this.prisma.notificationRecipient.delete({
      where: { id: recipientId },
    });

    return { success: true, message: 'Notification deleted successfully' };
  }

  /**
   * Clears all NotificationRecipient records for the authenticated user.
   * Safe: Does not delete other users' records.
   */
  async clearAllNotifications(userId: string) {
    await this.prisma.notificationRecipient.deleteMany({
      where: {
        userId,
      },
    });

    return { success: true, message: 'All notifications cleared successfully' };
  }
}
