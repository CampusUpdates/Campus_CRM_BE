import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import {
  CreateBroadcastDto,
  PreviewRecipientsDto,
  QueryBroadcastDto,
  QueryRecipientsDto,
} from './dto/broadcast.dto';

@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) { }

  /**
   * Resolves list of unique active user IDs based on targeting criteria.
   * If managerUserId is provided, restricts targeting to employees within the Manager's scope.
   */
  async resolveRecipientUsers(dto: PreviewRecipientsDto, managerUserId?: string) {
    const { targetAll, targetRoles = [], targetTeams = [], targetUserIds = [] } = dto;

    if (managerUserId) {
      // 1. Fetch teams managed by this manager
      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: managerUserId, isActive: true },
        select: { id: true, name: true },
      });
      const managedTeamIds = managedTeams.map((t) => t.id);

      // Validate targetTeams: Manager cannot target teams outside their managed scope
      if (targetTeams && targetTeams.length > 0) {
        const unauthorizedTeams = targetTeams.filter((id) => !managedTeamIds.includes(Number(id)));
        if (unauthorizedTeams.length > 0) {
          throw new ForbiddenException('You cannot broadcast to teams outside your authorized scope.');
        }
      }

      // 2. Fetch all active employees in this manager's scope
      const scopedUsers = await this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            ...(managedTeamIds.length > 0 ? [{ teamId: { in: managedTeamIds } }] : []),
            { managerId: managerUserId },
          ],
          id: { not: managerUserId },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          roleId: true,
          teamId: true,
          role: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });

      const scopedUserIdsSet = new Set(scopedUsers.map((u) => u.id));

      // Validate targetUserIds: Manager cannot target employees outside their managed scope
      if (targetUserIds && targetUserIds.length > 0) {
        const unauthorizedUsers = targetUserIds.filter((id) => !scopedUserIdsSet.has(id));
        if (unauthorizedUsers.length > 0) {
          throw new ForbiddenException('You cannot broadcast to employees outside your authorized scope.');
        }
      }

      // If targetAll is selected, return all scoped users
      if (targetAll) {
        return scopedUsers;
      }

      // Otherwise filter scoped users based on selected criteria
      const roleSet = targetRoles && targetRoles.length > 0 ? new Set(targetRoles.map(Number)) : null;
      const teamSet = targetTeams && targetTeams.length > 0 ? new Set(targetTeams.map(Number)) : null;
      const userSet = targetUserIds && targetUserIds.length > 0 ? new Set(targetUserIds) : null;

      if (!roleSet && !teamSet && !userSet) {
        return [];
      }

      return scopedUsers.filter((u) => {
        const matchRole = roleSet ? roleSet.has(u.roleId) : false;
        const matchTeam = teamSet && u.teamId ? teamSet.has(u.teamId) : false;
        const matchUser = userSet ? userSet.has(u.id) : false;
        return matchRole || matchTeam || matchUser;
      });
    }

    // SUPER_ADMIN: company-wide resolution
    if (targetAll) {
      return this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          roleId: true,
          teamId: true,
          role: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });
    }

    const roleConditions = targetRoles.length > 0 ? { roleId: { in: targetRoles.map(Number) } } : null;
    const teamConditions = targetTeams.length > 0 ? { teamId: { in: targetTeams.map(Number) } } : null;
    const userConditions = targetUserIds.length > 0 ? { id: { in: targetUserIds } } : null;

    const orClauses = [roleConditions, teamConditions, userConditions].filter(Boolean);

    if (orClauses.length === 0) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: orClauses as any,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        roleId: true,
        teamId: true,
        role: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  /**
   * Preview resolved recipient count and employee list before sending.
   */
  async previewRecipients(dto: PreviewRecipientsDto, managerUserId?: string) {
    const users = await this.resolveRecipientUsers(dto, managerUserId);
    return {
      count: users.length,
      recipients: users,
    };
  }

  /**
   * Creates and sends broadcast message, creating recipient tracking entries and CRM notifications.
   */
  async createBroadcast(dto: CreateBroadcastDto, currentUserId: string, managerUserId?: string) {
    const recipients = await this.resolveRecipientUsers(dto, managerUserId);

    if (recipients.length === 0) {
      throw new BadRequestException('No active employees match the selected targeting criteria.');
    }

    const uniqueRecipientIds = recipients.map((r) => r.id);

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Broadcast Message
      const broadcast = await tx.broadcastMessage.create({
        data: {
          title: dto.title.trim(),
          body: dto.body.trim(),
          createdById: currentUserId,
          status: 'SENT',
          targetAll: !!dto.targetAll,
          targetRoles: dto.targetRoles?.map(Number) || [],
          targetTeams: dto.targetTeams?.map(Number) || [],
          targetUserIds: dto.targetUserIds || [],
          sentAt: new Date(),
        },
      });

      // 2. Create Bulk Broadcast Recipient records
      await tx.broadcastRecipient.createMany({
        data: uniqueRecipientIds.map((userId) => ({
          broadcastId: broadcast.id,
          userId,
          deliveredAt: new Date(),
        })),
        skipDuplicates: true,
      });

      // 3. Send in-app notification to all recipients
      await this.notificationsService.createNotification(
        {
          title: `Announcement: ${broadcast.title}`,
          message:
            broadcast.body.length > 120
              ? `${broadcast.body.substring(0, 117)}...`
              : broadcast.body,
          type: NotificationType.SYSTEM,
          recipientUserIds: uniqueRecipientIds,
        },
        tx,
      );

      return {
        ...broadcast,
        recipientCount: uniqueRecipientIds.length,
      };
    });
  }

  /**
   * List broadcasts visible to user:
   * - SUPER_ADMIN: sees all sent broadcasts with aggregated delivery, read and acknowledgement stats.
   * - MANAGER: sees all broadcasts sent by this manager with aggregated delivery, read and acknowledgement stats.
   * - Employees (or when inbox=true): sees only broadcasts addressed to them, along with their individual read/ack status.
   */
  async getBroadcasts(
    query: QueryBroadcastDto,
    currentUserId: string,
    isSuperAdmin: boolean,
    isManager: boolean = false,
    isInbox: boolean = false,
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    if ((isSuperAdmin || isManager) && !isInbox) {
      const where: any = {};

      if (!isSuperAdmin && isManager) {
        where.createdById = currentUserId;
      }

      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { body: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (isSuperAdmin) {
        if (query.senderRole && query.senderRole !== 'ALL') {
          where.createdBy = {
            ...(where.createdBy || {}),
            role: { name: query.senderRole },
          };
        }

        if (query.senderId && query.senderId !== 'ALL') {
          where.createdById = query.senderId;
        }

        if (query.teamId && query.teamId !== 'ALL') {
          const tId = Number(query.teamId);
          where.OR = [
            ...(where.OR || []),
            { targetAll: true },
            { targetTeams: { has: tId } },
          ];
        }
      }

      // Date filtering on `createdAt` / `sentAt`
      const rawTime = (query.time || '').toLowerCase().trim();
      let dateWhere: any = null;

      if (rawTime === 'today') {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        dateWhere = { gte: startOfToday, lte: endOfToday };
      } else if (rawTime === 'yesterday') {
        const startOfYesterday = new Date();
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        startOfYesterday.setHours(0, 0, 0, 0);
        const endOfYesterday = new Date(startOfYesterday);
        endOfYesterday.setHours(23, 59, 59, 999);
        dateWhere = { gte: startOfYesterday, lte: endOfYesterday };
      } else if (rawTime === 'last_7_days' || rawTime === '7days' || rawTime === 'week') {
        const now = new Date();
        const start = new Date(now);
        start.setDate(now.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setHours(23, 59, 59, 999);
        dateWhere = { gte: start, lte: end };
      } else if (rawTime === 'this_month' || rawTime === 'month') {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        dateWhere = { gte: startOfMonth, lte: endOfMonth };
      } else if (rawTime === 'custom' || query.fromDate || query.toDate) {
        let startCustom: Date | null = null;
        let endCustom: Date | null = null;

        if (query.fromDate) {
          const fromStr = String(query.fromDate).trim();
          startCustom = new Date(fromStr);
          if (!isNaN(startCustom.getTime())) {
            startCustom.setHours(0, 0, 0, 0);
          }
        }
        if (query.toDate) {
          const toStr = String(query.toDate).trim();
          endCustom = new Date(toStr);
          if (!isNaN(endCustom.getTime())) {
            endCustom.setHours(23, 59, 59, 999);
          }
        }
        if (startCustom && endCustom) {
          dateWhere = { gte: startCustom, lte: endCustom };
        } else if (startCustom) {
          dateWhere = { gte: startCustom };
        } else if (endCustom) {
          dateWhere = { lte: endCustom };
        }
      }

      if (dateWhere) {
        where.createdAt = dateWhere;
      }

      const [total, items, allTeams, allRoles] = await Promise.all([
        this.prisma.broadcastMessage.count({ where }),
        this.prisma.broadcastMessage.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: { select: { id: true, name: true } },
              },
            },
            _count: {
              select: {
                recipients: true,
              },
            },
          },
        }),
        this.prisma.team.findMany({ select: { id: true, name: true } }),
        this.prisma.role.findMany({ select: { id: true, name: true } }),
      ]);

      const teamMap = new Map<number, string>(allTeams.map((t) => [t.id, t.name]));
      const roleMap = new Map<number, string>(allRoles.map((r) => [r.id, r.name]));

      // Aggregate counts for each broadcast
      const broadcastIds = items.map((b) => b.id);
      const [readCounts, ackCounts] = await Promise.all([
        this.prisma.broadcastRecipient.groupBy({
          by: ['broadcastId'],
          where: {
            broadcastId: { in: broadcastIds },
            readAt: { not: null },
          },
          _count: { _all: true },
        }),
        this.prisma.broadcastRecipient.groupBy({
          by: ['broadcastId'],
          where: {
            broadcastId: { in: broadcastIds },
            acknowledgedAt: { not: null },
          },
          _count: { _all: true },
        }),
      ]);

      const readMap = new Map<string, number>(readCounts.map((r) => [r.broadcastId, r._count._all]));
      const ackMap = new Map<string, number>(ackCounts.map((a) => [a.broadcastId, a._count._all]));

      const formatAudience = (b: any) => {
        if (b.targetAll) {
          return b.createdBy?.role?.name === 'MANAGER' ? 'All Team Members' : 'All Employees';
        }
        const parts: string[] = [];
        if (b.targetTeams && b.targetTeams.length > 0) {
          const names = b.targetTeams.map((id: number) => teamMap.get(id) || `Team #${id}`);
          parts.push(`Teams: ${names.join(', ')}`);
        }
        if (b.targetRoles && b.targetRoles.length > 0) {
          const names = b.targetRoles.map((id: number) => roleMap.get(id)?.replace(/_/g, ' ') || `Role #${id}`);
          parts.push(`Roles: ${names.join(', ')}`);
        }
        if (b.targetUserIds && b.targetUserIds.length > 0) {
          parts.push(`${b.targetUserIds.length} Employee${b.targetUserIds.length > 1 ? 's' : ''}`);
        }
        return parts.length > 0 ? parts.join(' • ') : 'Custom Selection';
      };

      let enriched = items.map((b) => {
        const totalRecipients = b._count?.recipients ?? 0;
        const readCount = readMap.get(b.id) || 0;
        const acknowledgedCount = ackMap.get(b.id) || 0;
        return {
          id: b.id,
          title: b.title,
          body: b.body,
          status: b.status,
          createdAt: b.createdAt,
          sentAt: b.sentAt,
          createdBy: b.createdBy,
          targetAll: b.targetAll,
          targetRoles: b.targetRoles,
          targetTeams: b.targetTeams,
          targetUserIds: b.targetUserIds,
          targetAudience: formatAudience(b),
          totalRecipients,
          readCount,
          unreadCount: Math.max(0, totalRecipients - readCount),
          acknowledgedCount,
          pendingAckCount: Math.max(0, totalRecipients - acknowledgedCount),
        };
      });

      // Filter by ackStatus in-memory if specified
      if (query.ackStatus === 'ACKNOWLEDGED') {
        enriched = enriched.filter((b) => b.totalRecipients > 0 && b.acknowledgedCount === b.totalRecipients);
      } else if (query.ackStatus === 'PENDING') {
        enriched = enriched.filter((b) => b.acknowledgedCount < b.totalRecipients);
      }

      return {
        data: enriched,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } else {
      // Regular employee inbox
      const where: any = {
        userId: currentUserId,
      };

      if (query.ackStatus === 'ACKNOWLEDGED') {
        where.acknowledgedAt = { not: null };
      } else if (query.ackStatus === 'PENDING') {
        where.acknowledgedAt = null;
      }

      if (query.readStatus === 'READ') {
        where.readAt = { not: null };
      } else if (query.readStatus === 'UNREAD') {
        where.readAt = null;
      }

      if (search) {
        where.broadcast = {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { body: { contains: search, mode: 'insensitive' } },
          ],
        };
      }

      const [total, items] = await Promise.all([
        this.prisma.broadcastRecipient.count({ where }),
        this.prisma.broadcastRecipient.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            broadcast: {
              include: {
                createdBy: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      const formatted = items.map((item) => ({
        id: item.broadcast.id,
        recipientRecordId: item.id,
        title: item.broadcast.title,
        body: item.broadcast.body,
        sentAt: item.broadcast.sentAt || item.broadcast.createdAt,
        createdBy: item.broadcast.createdBy,
        deliveredAt: item.deliveredAt,
        readAt: item.readAt,
        acknowledgedAt: item.acknowledgedAt,
        isRead: !!item.readAt,
        isAcknowledged: !!item.acknowledgedAt,
      }));

      return {
        data: formatted,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  }

  /**
   * Get single broadcast details.
   */
  async getBroadcastById(
    id: string,
    currentUserId: string,
    isSuperAdmin: boolean,
    isManager: boolean = false,
  ) {
    const broadcast = await this.prisma.broadcastMessage.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!broadcast) {
      throw new NotFoundException('Broadcast message not found');
    }

    const isCreator = broadcast.createdById === currentUserId;

    let recipientRecord = await this.prisma.broadcastRecipient.findUnique({
      where: {
        broadcastId_userId: {
          broadcastId: id,
          userId: currentUserId,
        },
      },
    });

    if (!isSuperAdmin && !isCreator && !recipientRecord) {
      throw new ForbiddenException('You are not authorized to view this broadcast');
    }

    // If regular recipient opens message and has not been marked as read yet, automatically record read timestamp
    if (recipientRecord && !recipientRecord.readAt) {
      recipientRecord = await this.prisma.broadcastRecipient.update({
        where: { id: recipientRecord.id },
        data: { readAt: new Date() },
      });
    }

    if (isSuperAdmin || isCreator) {
      const [totalRecipients, readCount, acknowledgedCount] = await Promise.all([
        this.prisma.broadcastRecipient.count({ where: { broadcastId: id } }),
        this.prisma.broadcastRecipient.count({ where: { broadcastId: id, readAt: { not: null } } }),
        this.prisma.broadcastRecipient.count({ where: { broadcastId: id, acknowledgedAt: { not: null } } }),
      ]);

      return {
        ...broadcast,
        recipientStatus: recipientRecord
          ? {
            isRead: !!recipientRecord.readAt,
            readAt: recipientRecord.readAt,
            isAcknowledged: !!recipientRecord.acknowledgedAt,
            acknowledgedAt: recipientRecord.acknowledgedAt,
          }
          : null,
        metrics: {
          totalRecipients,
          deliveredCount: totalRecipients,
          readCount,
          unreadCount: Math.max(0, totalRecipients - readCount),
          acknowledgedCount,
          pendingAckCount: Math.max(0, totalRecipients - acknowledgedCount),
        },
      };
    }

    return {
      id: broadcast.id,
      title: broadcast.title,
      body: broadcast.body,
      createdAt: broadcast.createdAt,
      sentAt: broadcast.sentAt,
      createdBy: broadcast.createdBy,
      recipientStatus: {
        isRead: !!recipientRecord?.readAt,
        readAt: recipientRecord?.readAt,
        isAcknowledged: !!recipientRecord?.acknowledgedAt,
        acknowledgedAt: recipientRecord?.acknowledgedAt,
      },
    };
  }

  /**
   * Record that the current recipient has read the message. Idempotent.
   * Does NOT mark as acknowledged.
   */
  async markAsRead(broadcastId: string, currentUserId: string) {
    const recipient = await this.prisma.broadcastRecipient.findUnique({
      where: {
        broadcastId_userId: {
          broadcastId,
          userId: currentUserId,
        },
      },
    });

    if (!recipient) {
      throw new ForbiddenException('You are not a recipient of this broadcast');
    }

    if (!recipient.readAt) {
      return this.prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { readAt: new Date() },
      });
    }

    return recipient;
  }

  /**
   * Explicitly acknowledge the message.
   * Business rule: A user cannot acknowledge a broadcast they were not sent.
   * Acknowledgement is permitted only when read (if unread, mark readAt as well).
   * Idempotent: Does not alter original acknowledgedAt timestamp if already acknowledged.
   */
  async acknowledge(broadcastId: string, currentUserId: string) {
    const recipient = await this.prisma.broadcastRecipient.findUnique({
      where: {
        broadcastId_userId: {
          broadcastId,
          userId: currentUserId,
        },
      },
    });

    if (!recipient) {
      throw new ForbiddenException('You are not a recipient of this broadcast');
    }

    if (recipient.acknowledgedAt) {
      return recipient;
    }

    const now = new Date();
    return this.prisma.broadcastRecipient.update({
      where: { id: recipient.id },
      data: {
        readAt: recipient.readAt || now,
        acknowledgedAt: now,
      },
    });
  }

  /**
   * Acknowledgement tracking report for administrators and sending managers.
   * Includes pagination, search, and filtering by team, role, read status, and acknowledgement status.
   */
  async getRecipientsReport(
    broadcastId: string,
    query: QueryRecipientsDto,
    currentUserId?: string,
    isSuperAdmin: boolean = true,
  ) {
    const broadcast = await this.prisma.broadcastMessage.findUnique({
      where: { id: broadcastId },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!broadcast) {
      throw new NotFoundException('Broadcast message not found');
    }

    if (!isSuperAdmin && currentUserId && broadcast.createdById !== currentUserId) {
      throw new ForbiddenException('You can only view recipient tracking reports for broadcasts you created.');
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      broadcastId,
    };

    if (query.readStatus === 'READ') {
      where.readAt = { not: null };
    } else if (query.readStatus === 'UNREAD') {
      where.readAt = null;
    }

    if (query.ackStatus === 'ACKNOWLEDGED') {
      where.acknowledgedAt = { not: null };
    } else if (query.ackStatus === 'PENDING') {
      where.acknowledgedAt = null;
    }

    const userWhere: any = {};

    if (query.teamId && query.teamId !== 'ALL') {
      userWhere.teamId = Number(query.teamId);
    }

    if (query.roleId && query.roleId !== 'ALL') {
      userWhere.roleId = Number(query.roleId);
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      userWhere.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (Object.keys(userWhere).length > 0) {
      where.user = userWhere;
    }

    const [total, items, overallStats, allTeams, allRoles] = await Promise.all([
      this.prisma.broadcastRecipient.count({ where }),
      this.prisma.broadcastRecipient.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }],
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              role: { select: { id: true, name: true } },
              team: { select: { id: true, name: true } },
            },
          },
        },
      }),
      Promise.all([
        this.prisma.broadcastRecipient.count({ where: { broadcastId } }),
        this.prisma.broadcastRecipient.count({ where: { broadcastId, readAt: { not: null } } }),
        this.prisma.broadcastRecipient.count({ where: { broadcastId, acknowledgedAt: { not: null } } }),
      ]),
      this.prisma.team.findMany({ select: { id: true, name: true } }),
      this.prisma.role.findMany({ select: { id: true, name: true } }),
    ]);

    const [totalRecipients, readCount, acknowledgedCount] = overallStats;
    const teamMap = new Map<number, string>(allTeams.map((t) => [t.id, t.name]));
    const roleMap = new Map<number, string>(allRoles.map((r) => [r.id, r.name]));

    const formatAudience = (b: any) => {
      if (b.targetAll) {
        return b.createdBy?.role?.name === 'MANAGER' ? 'All Team Members' : 'All Employees';
      }
      const parts: string[] = [];
      if (b.targetTeams && b.targetTeams.length > 0) {
        const names = b.targetTeams.map((id: number) => teamMap.get(id) || `Team #${id}`);
        parts.push(`Teams: ${names.join(', ')}`);
      }
      if (b.targetRoles && b.targetRoles.length > 0) {
        const names = b.targetRoles.map((id: number) => roleMap.get(id)?.replace(/_/g, ' ') || `Role #${id}`);
        parts.push(`Roles: ${names.join(', ')}`);
      }
      if (b.targetUserIds && b.targetUserIds.length > 0) {
        parts.push(`${b.targetUserIds.length} Employee${b.targetUserIds.length > 1 ? 's' : ''}`);
      }
      return parts.length > 0 ? parts.join(' • ') : 'Custom Selection';
    };

    return {
      broadcast: {
        id: broadcast.id,
        title: broadcast.title,
        body: broadcast.body,
        createdAt: broadcast.createdAt,
        sentAt: broadcast.sentAt,
        createdBy: broadcast.createdBy,
        targetAll: broadcast.targetAll,
        targetRoles: broadcast.targetRoles,
        targetTeams: broadcast.targetTeams,
        targetUserIds: broadcast.targetUserIds,
        targetAudience: formatAudience(broadcast),
      },
      metrics: {
        totalRecipients,
        deliveredCount: totalRecipients,
        readCount,
        unreadCount: Math.max(0, totalRecipients - readCount),
        acknowledgedCount,
        pendingAckCount: Math.max(0, totalRecipients - acknowledgedCount),
      },
      data: items.map((item) => ({
        id: item.id,
        userId: item.user.id,
        name: `${item.user.firstName} ${item.user.lastName || ''}`.trim(),
        email: item.user.email,
        phone: item.user.phone,
        role: item.user.role?.name || 'N/A',
        team: item.user.team?.name || 'Unassigned',
        deliveredAt: item.deliveredAt,
        readAt: item.readAt,
        acknowledgedAt: item.acknowledgedAt,
        isRead: !!item.readAt,
        isAcknowledged: !!item.acknowledgedAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Export recipient acknowledgement status as CSV rows.
   */
  async exportRecipientsCsv(
    broadcastId: string,
    query: QueryRecipientsDto,
    currentUserId?: string,
    isSuperAdmin: boolean = true,
  ) {
    const result = await this.getRecipientsReport(
      broadcastId,
      {
        ...query,
        page: 1,
        limit: 10000,
      },
      currentUserId,
      isSuperAdmin,
    );

    const header = [
      'Employee Name',
      'Email',
      'Phone',
      'Role',
      'Team',
      'Delivered At',
      'Read Status',
      'Read At',
      'Acknowledgement Status',
      'Acknowledged At',
    ].join(',');

    const rows = result.data.map((r) => {
      const escape = (str?: string | null) => `"${(str || '').replace(/"/g, '""')}"`;
      return [
        escape(r.name),
        escape(r.email),
        escape(r.phone),
        escape(r.role),
        escape(r.team),
        escape(r.deliveredAt ? new Date(r.deliveredAt).toISOString() : ''),
        escape(r.isRead ? 'Read' : 'Unread'),
        escape(r.readAt ? new Date(r.readAt).toISOString() : ''),
        escape(r.isAcknowledged ? 'Acknowledged' : 'Pending'),
        escape(r.acknowledgedAt ? new Date(r.acknowledgedAt).toISOString() : ''),
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }
}
