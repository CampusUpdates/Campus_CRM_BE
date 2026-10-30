import { Injectable, NotFoundException, MessageEvent } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { Subject, Observable } from 'rxjs';

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
  private readonly userStreams = new Map<string, Subject<MessageEvent>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves or initializes an active SSE stream for a specific authenticated user.
   */
  getUserStream(userId: string): Observable<MessageEvent> {
    let userSubject = this.userStreams.get(userId);
    if (!userSubject || userSubject.closed) {
      userSubject = new Subject<MessageEvent>();
      this.userStreams.set(userId, userSubject);
    }

    // Send initial handshake ping
    setTimeout(() => {
      userSubject?.next({
        data: {
          type: 'CONNECTED',
          userId,
          timestamp: new Date().toISOString(),
        },
      } as MessageEvent);
    }, 50);

    return userSubject.asObservable();
  }

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

    // Real-time delivery via SSE to authorized recipient streams
    setTimeout(() => {
      try {
        for (const recipient of notification.recipients) {
          const stream = this.userStreams.get(recipient.userId);
          if (stream && !stream.closed) {
            stream.next({
              data: {
                type: 'NOTIFICATION',
                notification: {
                  id: notification.id,
                  title: notification.title,
                  message: notification.message,
                  type: notification.type,
                  createdAt: notification.createdAt,
                  isRead: recipient.isRead,
                },
              },
            } as MessageEvent);
          }
        }
      } catch (err) {
        // non-blocking SSE broadcast
      }
    }, 0);

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

  /**
   * Retrieves persistent, database-backed unread indicators for sidebar modules.
   * Tracks unread counts independently for College Counselling, Colleges, and Notifications.
   */
  async getSidebarIndicators(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        roleId: true,
        role: { select: { name: true } },
        teamId: true,
        createdAt: true,
      },
    });

    if (!user) {
      return {
        counsellingUnread: 0,
        collegesUnread: 0,
        notificationsUnread: 0,
      };
    }

    const defaultSince = user.createdAt || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Fetch existing module read states
    const [counsellingReadState, collegesReadState, leadsReadState] = await Promise.all([
      this.prisma.userModuleReadState.findUnique({
        where: {
          userId_module: {
            userId,
            module: 'COLLEGE_COUNSELLING',
          },
        },
      }),
      this.prisma.userModuleReadState.findUnique({
        where: {
          userId_module: {
            userId,
            module: 'COLLEGES',
          },
        },
      }),
      this.prisma.userModuleReadState.findUnique({
        where: {
          userId_module: {
            userId,
            module: 'LEADS',
          },
        },
      }),
    ]);

    const counsellingSince = counsellingReadState?.lastSeenAt ?? defaultSince;
    const collegesSince = collegesReadState?.lastSeenAt ?? defaultSince;
    const leadsSince = leadsReadState?.lastSeenAt ?? defaultSince;

    // 1. Calculate Leads Unread Count from unread notifications belonging to this user
    const leadsCount = await this.prisma.notificationRecipient.count({
      where: {
        userId,
        isRead: false,
        notification: {
          OR: [
            { type: 'LEAD' },
            {
              title: {
                in: [
                  'New Lead Created',
                  'Lead Posted',
                  'New Lead Assigned',
                  'Lead Reallocated to You',
                  'Lead Shared',
                ],
              },
            },
          ],
        },
      },
    });

    // 2. Calculate College Counselling Unread Count from unread notifications belonging to this user
    const counsellingCount = await this.prisma.notificationRecipient.count({
      where: {
        userId,
        isRead: false,
        notification: {
          OR: [
            {
              title: {
                in: ['Counselling Requested', 'Counselling Completed'],
              },
            },
            { message: { contains: '/counselling' } },
          ],
        },
      },
    });

    // 3. Calculate Colleges Unread Count (new colleges created in Colleges module)
    const collegesCount = await this.prisma.college.count({
      where: {
        createdAt: { gt: collegesSince },
        isActive: true,
      },
    });

    // 4. Notifications total unread count
    const notificationsCount = await this.getUnreadCount(userId);

    return {
      leadsUnread: leadsCount,
      counsellingUnread: counsellingCount,
      collegesUnread: collegesCount,
      notificationsUnread: notificationsCount.count,
    };
  }

  /**
   * Persists the user's viewed timestamp for a specific sidebar module,
   * and marks unread notifications belonging to that module as read for this user.
   */
  async markModuleSeen(userId: string, module: string) {
    const now = new Date();
    await this.prisma.userModuleReadState.upsert({
      where: {
        userId_module: {
          userId,
          module,
        },
      },
      create: {
        userId,
        module,
        lastSeenAt: now,
      },
      update: {
        lastSeenAt: now,
      },
    });

    if (module === 'LEADS') {
      const leadRecipients = await this.prisma.notificationRecipient.findMany({
        where: {
          userId,
          isRead: false,
          notification: {
            OR: [
              { type: 'LEAD' },
              {
                title: {
                  in: [
                    'New Lead Created',
                    'Lead Posted',
                    'New Lead Assigned',
                    'Lead Reallocated to You',
                    'Lead Shared',
                  ],
                },
              },
            ],
          },
        },
        select: { id: true },
      });

      if (leadRecipients.length > 0) {
        await this.prisma.notificationRecipient.updateMany({
          where: {
            id: { in: leadRecipients.map((r) => r.id) },
          },
          data: {
            isRead: true,
            readAt: now,
          },
        });
      }
    } else if (module === 'COLLEGE_COUNSELLING') {
      const counsellingRecipients = await this.prisma.notificationRecipient.findMany({
        where: {
          userId,
          isRead: false,
          notification: {
            OR: [
              {
                title: {
                  in: ['Counselling Requested', 'Counselling Completed'],
                },
              },
              { message: { contains: '/counselling' } },
            ],
          },
        },
        select: { id: true },
      });

      if (counsellingRecipients.length > 0) {
        await this.prisma.notificationRecipient.updateMany({
          where: {
            id: { in: counsellingRecipients.map((r) => r.id) },
          },
          data: {
            isRead: true,
            readAt: now,
          },
        });
      }
    }

    return { success: true, module, lastSeenAt: now };
  }
}
