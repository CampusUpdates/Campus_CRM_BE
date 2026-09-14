import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueryActivityLogDto } from './dto/query-activity-log.dto';
import { ActivityType } from '@prisma/client';

@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  private async buildActivityVisibilityFilter(
    userId: string,
    roleId: number,
  ): Promise<any> {
    let isSuperAdmin = roleId === 1;
    let isManager = roleId === 3;
    let roleName = '';

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: { select: { name: true } },
      },
    });

    if (user?.role?.name) {
      roleName = user.role.name.toUpperCase();
      if (roleName.includes('SUPER_ADMIN')) isSuperAdmin = true;
      if (roleName.includes('MANAGER')) isManager = true;
    }

    // 1. SUPER_ADMIN: Can view all system activity logs
    if (isSuperAdmin) {
      return {};
    }

    // 2. MANAGER: Can view own activity + activity of advisors in managed teams
    if (isManager) {
      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: userId },
        select: { id: true },
      });
      const managedTeamIds = managedTeams.map((t) => t.id);

      if (managedTeamIds.length === 0) {
        return { userId };
      }

      return {
        OR: [{ userId }, { user: { teamId: { in: managedTeamIds } } }],
      };
    }

    // 3. HR: Can view activity performed by HR users
    if (roleName.includes('HR') || roleName.includes('HUMAN')) {
      return {
        user: {
          role: {
            name: { contains: 'HR', mode: 'insensitive' },
          },
        },
      };
    }

    // 4. PROGRAM ADVISOR: Can view ONLY their own activity
    if (roleName.includes('ADVISOR') || roleName.includes('PROGRAM')) {
      return { userId };
    }

    // Default fallback: Restrict to own activity if userId exists
    if (userId) {
      return { userId };
    }

    throw new ForbiddenException(
      'Access denied: Unauthorized to view Activity Logs.',
    );
  }

  async findAll(
    query: QueryActivityLogDto,
    currentUserId: string,
    currentUserRoleId: number,
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const visibilityWhere = await this.buildActivityVisibilityFilter(
      currentUserId,
      currentUserRoleId,
    );

    const andConditions: any[] = [visibilityWhere];

    if (query.activity) {
      andConditions.push({ activity: query.activity });
    }
    if (query.entityType) {
      andConditions.push({ entityType: query.entityType });
    }
    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      andConditions.push({
        OR: [
          { description: { contains: s, mode: 'insensitive' } },
          { entityId: { contains: s, mode: 'insensitive' } },
          { user: { firstName: { contains: s, mode: 'insensitive' } } },
          { user: { lastName: { contains: s, mode: 'insensitive' } } },
          { user: { username: { contains: s, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.userId && query.userId.trim()) {
      andConditions.push({ userId: query.userId.trim() });
    }

    const where = { AND: andConditions };

    const [total, items] = await Promise.all([
      this.prisma.activityLog.count({ where }),
      this.prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              email: true,
              role: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        hasMore: page * limit < total,
      },
    };
  }

  async createLog(data: {
    userId: string;
    activity: ActivityType;
    entityType: string;
    entityId: string;
    description?: string;
  }) {
    return this.prisma.activityLog.create({
      data,
    });
  }
}
