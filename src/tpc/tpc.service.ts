import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AssignTpcDto } from './dto/assign-tpc.dto';
import { UpdateTpcStatusDto } from './dto/update-tpc-status.dto';
import { GetTpcReportDto } from './dto/get-tpc-report.dto';
import { USER_SAFE_SELECT } from 'src/common/constants/constants.user';
import { UserStatus, CallOutcome } from '@prisma/client';

@Injectable()
export class TpcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) { }

  async getSelectableUsers() {
    return this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        role: {
          name: {
            not: 'HR',
          },
        },
      },
      select: USER_SAFE_SELECT,
      orderBy: [
        { firstName: 'asc' },
        { lastName: 'asc' },
      ],
    });
  }


  async assignTpc(dto: AssignTpcDto, assignedById: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: dto.leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // Find or create TPC entry for this lead
      let tpc = await tx.tPC.findFirst({
        where: { leadId: dto.leadId },
      });

      if (!tpc) {
        tpc = await tx.tPC.create({
          data: {
            leadId: dto.leadId,
          },
        });
      }

      // Filter out duplicate user IDs and existing user assignments
      const uniqueAssignedToIds = Array.from(new Set(dto.assignedToIds));
      const existing = await tx.tPCUser.findMany({
        where: { tpcId: tpc.id },
        select: { assignedToId: true },
      });
      const existingIds = new Set(existing.map((e) => e.assignedToId));
      const idsToAssign = uniqueAssignedToIds.filter(
        (id) => !existingIds.has(id),
      );

      if (idsToAssign.length > 0) {
        // Create TPCUser entries for each assigned user
        await tx.tPCUser.createMany({
          data: idsToAssign.map((assignedToId) => ({
            tpcId: tpc.id,
            assignedById,
            assignedToId,
            status: 'PENDING',
          })),
        });

        // Log activity
        await tx.activityLog.create({
          data: {
            userId: assignedById,
            activity: 'TPC',
            entityType: 'TPC',
            entityId: tpc.id,
            description: `Assigned TPC call for lead ${lead.firstName} to ${idsToAssign.length} user(s)`,
          },
        });

        const assigner = await tx.user.findUnique({
          where: { id: assignedById },
          select: { firstName: true, lastName: true },
        });
        const assignerName = assigner
          ? [assigner.firstName, assigner.lastName].filter(Boolean).join(' ')
          : 'Manager';
        const leadName = [lead.firstName, lead.lastName]
          .filter(Boolean)
          .join(' ');

        await this.notificationsService.createNotification(
          {
            title: 'New TPC Assigned',
            message: `${assignerName} assigned you a TPC for ${leadName}.`,
            type: 'TPC',
            recipientUserIds: idsToAssign,
          },
          tx,
        );
      }

      // Return refreshed TPC with assignments
      return tx.tPC.findUnique({
        where: { id: tpc.id },
        include: {
          lead: true,
          assignments: {
            include: {
              assignedBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  username: true,
                },
              },
              assignedTo: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  username: true,
                  email: true,
                  role: { select: { name: true } },
                },
              },
              completedBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  username: true,
                },
              },
            },
            orderBy: { assignedAt: 'desc' },
          },
        },
      });
    }, { maxWait: 10000, timeout: 30000 });
  }

  async getMyTpcs(userId: string) {
    return this.prisma.tPCUser.findMany({
      where: { assignedById: userId },
      include: {
        tpc: {
          include: {
            lead: {
              include: {
                status: true,
                collegeApplications: {
                  include: {
                    college: true,
                    status: true,
                  },
                },
                negativeColleges: true,
              },
            },
          },
        },
        calls: {
          orderBy: { createdAt: 'desc' },
          include: {
            caller: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: { select: { name: true } },
              }
            }
          }
        },
        assignedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            role: { select: { name: true } },
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            role: { select: { name: true } },
          },
        },
        completedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getAssignedTpcs(userId: string) {
    return this.prisma.tPCUser.findMany({
      where: { assignedToId: userId },
      include: {
        tpc: {
          include: {
            lead: {
              include: {
                status: true,
                collegeApplications: {
                  include: {
                    college: true,
                    status: true,
                  },
                },
                negativeColleges: true,
              },
            },
          },
        },
        calls: {
          orderBy: { createdAt: 'desc' },
          include: {
            caller: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: { select: { name: true } },
              }
            }
          }
        },
        assignedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            role: { select: { name: true } },
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            role: { select: { name: true } },
          },
        },
        completedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getAllTpcs(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    const isGlobalAccess =
      user?.role?.name === 'SUPER_ADMIN' || user?.role?.name === 'MANAGER';

    const tpcRecords = await this.prisma.tPC.findMany({
      where: isGlobalAccess
        ? {}
        : {
          OR: [
            {
              assignments: {
                some: {
                  OR: [{ assignedToId: userId }, { assignedById: userId }],
                },
              },
            },
            {
              lead: {
                createdById: userId,
              },
            },
          ],
        },
      include: {
        lead: {
          include: {
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            status: true,
            collegeApplications: {
              include: {
                college: true,
                status: true,
              },
            },
            negativeColleges: true,
          },
        },
        assignments: {
          include: {
            assignedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                role: { select: { name: true } },
              },
            },
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                email: true,
                role: { select: { name: true } },
              },
            },
            completedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
              },
            },
          },
          orderBy: { assignedAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return tpcRecords;
  }

  async getTpcsForLead(leadId: string) {
    const tpc = await this.prisma.tPC.findFirst({
      where: { leadId },
      include: {
        lead: {
          include: {
            status: true,
            collegeApplications: {
              include: {
                college: true,
                status: true,
              },
            },
            negativeColleges: true,
          },
        },
        assignments: {
          include: {
            assignedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                role: { select: { name: true } },
              },
            },
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                email: true,
                role: { select: { name: true } },
              },
            },
            completedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
              },
            },
          },
          orderBy: { assignedAt: 'desc' },
        },
      },
    });

    return tpc || null;
  }

  async updateAssignmentStatus(
    assignmentId: string,
    dto: UpdateTpcStatusDto,
    userId: string,
  ) {
    const isCompleted = dto.status === 'COMPLETED';

    const updated = await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.tPCUser.findUnique({
        where: { id: assignmentId },
        include: { calls: true }
      });

      if (!assignment) {
        throw new NotFoundException('TPC assignment not found');
      }

      if (dto.outcome || dto.notes !== undefined) {
        await tx.tPCCall.create({
          data: {
            tpcUserId: assignmentId,
            callerId: userId,
            outcome: dto.outcome || CallOutcome.OTHER,
            notes: dto.notes ? dto.notes.trim() : null,
          },
        });
      }

      const callsCount = await tx.tPCCall.count({ where: { tpcUserId: assignmentId } });

      if (isCompleted && callsCount < 3) {
        throw new BadRequestException(
          'TPC must be attempted at least 3 times before completion.',
        );
      }

      return tx.tPCUser.update({
        where: { id: assignmentId },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          attempts: callsCount,
          ...(dto.status === 'COMPLETED' ? {
            completedById: userId,
            completedAt: new Date()
          } : dto.status ? {
            completedById: null,
            completedAt: null
          } : {})
        },
        include: {
          tpc: {
            include: {
              lead: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
          assignedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: { select: { name: true } },
            },
          },
          calls: {
            orderBy: { createdAt: 'desc' },
            include: {
              caller: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  role: { select: { name: true } },
                }
              }
            }
          },
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: { select: { name: true } },
            },
          },
          completedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });
    }, { maxWait: 10000, timeout: 30000 });

    await this.prisma.activityLog.create({
      data: {
        userId,
        activity: 'TPC',
        entityType: 'TPCUser',
        entityId: updated.id,
        description: `Marked TPC assignment as ${dto.status} for lead ${updated.tpc.lead?.firstName || ''}`,
      },
    });

    return updated;
  }

  async removeAssignment(assignmentId: string) {
    const assignment = await this.prisma.tPCUser.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      throw new NotFoundException('TPC assignment not found');
    }

    await this.prisma.tPCUser.delete({
      where: { id: assignmentId },
    });

    return { message: 'TPC assignment removed successfully' };
  }
  async getTpcReports(userId: string, query: GetTpcReportDto = {}) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        teamId: true,
        role: { select: { id: true, name: true } },
      },
    });

    if (!user || !user.role) {
      throw new ForbiddenException('User account or role not found');
    }

    const roleName = (user.role.name || '').toUpperCase();
    const isSuperAdmin = ['SUPER_ADMIN', 'SUPERADMIN', 'ADMIN'].includes(roleName);
    const isManager = ['MANAGER'].includes(roleName);

    if (!isSuperAdmin && !isManager) {
      throw new ForbiddenException('Access denied: You are not authorized to view TPC reports');
    }

    let managedTeamIds: number[] = [];
    let allTeamIds: number[] = [];
    let scopedUserIds: string[] = [];

    if (isManager) {
      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: userId, isActive: true },
        select: { id: true },
      });
      managedTeamIds = managedTeams.map((t) => t.id);
      allTeamIds = Array.from(
        new Set([...managedTeamIds, ...(user.teamId ? [user.teamId] : [])]),
      );

      const teamMembers = await this.prisma.user.findMany({
        where: {
          OR: [
            ...(allTeamIds.length > 0 ? [{ teamId: { in: allTeamIds } }] : []),
            { managerId: userId },
            { id: userId },
          ],
        },
        select: { id: true },
      });
      scopedUserIds = Array.from(new Set(teamMembers.map((m) => m.id)));
    }

    // Apply target filters while strictly enforcing server-side scope
    let targetTeamIds: number[] = isManager ? [...allTeamIds] : [];
    let targetUserIds: string[] = isManager ? [...scopedUserIds] : [];

    if (query.teamId) {
      const requestedTeamId = Number(query.teamId);
      if (isManager && !allTeamIds.includes(requestedTeamId)) {
        throw new ForbiddenException(
          'Access denied: You cannot view TPC reports for teams outside your authorized scope.',
        );
      }
      targetTeamIds = [requestedTeamId];
      const teamMembers = await this.prisma.user.findMany({
        where: { teamId: requestedTeamId },
        select: { id: true },
      });
      const teamUserIds = teamMembers.map((m) => m.id);
      targetUserIds = isManager
        ? targetUserIds.filter((id) => teamUserIds.includes(id))
        : teamUserIds;
    }

    if (query.userId) {
      const requestedUserId = String(query.userId);
      if (isManager && !scopedUserIds.includes(requestedUserId)) {
        throw new ForbiddenException(
          'Access denied: You cannot view TPC reports for employees outside your authorized scope.',
        );
      }
      targetUserIds = [requestedUserId];
    }

    // Period / Date bounds
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let periodDateRange: { gte?: Date; lte?: Date } | null = null;
    if (query.period && query.period !== 'all') {
      const now = new Date();
      if (query.period === 'today') {
        periodDateRange = { gte: startOfToday, lte: endOfToday };
      } else if (query.period === 'yesterday') {
        const startYesterday = new Date(startOfToday);
        startYesterday.setDate(startYesterday.getDate() - 1);
        const endYesterday = new Date(startOfToday);
        endYesterday.setMilliseconds(-1);
        periodDateRange = { gte: startYesterday, lte: endYesterday };
      } else if (query.period === '7days') {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        periodDateRange = { gte: sevenDaysAgo, lte: now };
      } else if (query.period === '30days') {
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        periodDateRange = { gte: thirtyDaysAgo, lte: now };
      }
    }

    // Define scoped Lead condition
    const leadScopedWhere: any = isManager
      ? {
          OR: [
            ...(targetTeamIds.length > 0 ? [{ teamId: { in: targetTeamIds } }] : []),
            ...(targetUserIds.length > 0 ? [{ createdById: { in: targetUserIds } }] : []),
            ...(targetUserIds.length > 0
              ? [
                  {
                    assignments: {
                      some: {
                        userId: { in: targetUserIds },
                      },
                    },
                  },
                ]
              : []),
          ],
        }
      : query.teamId || query.userId
      ? {
          OR: [
            ...(query.teamId ? [{ teamId: Number(query.teamId) }] : []),
            ...(targetUserIds.length > 0
              ? [
                  {
                    assignments: {
                      some: {
                        userId: { in: targetUserIds },
                      },
                    },
                  },
                ]
              : []),
          ],
        }
      : {};

    // 1. activeLeadsToday count
    const activeLeadsWhere: any = {
      assignments: {
        some: {
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
          ...(isManager || query.userId ? { userId: { in: targetUserIds } } : {}),
        },
      },
    };
    if (isManager) {
      activeLeadsWhere.OR = [
        ...(targetTeamIds.length > 0 ? [{ teamId: { in: targetTeamIds } }] : []),
        { createdById: { in: targetUserIds } },
        { assignments: { some: { status: 'ACTIVE', expiresAt: { gt: new Date() }, userId: { in: targetUserIds } } } },
      ];
    } else if (query.teamId) {
      activeLeadsWhere.teamId = Number(query.teamId);
    }
    const activeLeadsToday = await this.prisma.lead.count({ where: activeLeadsWhere });

    // 2. tpcAssignedToday count
    const tpcAssignedWhere: any = {
      assignedAt: periodDateRange || {
        gte: startOfToday,
        lte: endOfToday,
      },
    };
    if (isManager || query.teamId || query.userId) {
      tpcAssignedWhere.OR = [
        ...(targetUserIds.length > 0
          ? [
              { assignedToId: { in: targetUserIds } },
              { assignedById: { in: targetUserIds } },
            ]
          : []),
        { tpc: { lead: leadScopedWhere } },
      ];
    }
    const tpcAssignedToday = await this.prisma.tPCUser.count({ where: tpcAssignedWhere });

    // 3. tpcCompleted count
    const tpcCompletedWhere: any = {
      status: 'COMPLETED',
    };
    if (periodDateRange) {
      tpcCompletedWhere.completedAt = periodDateRange;
    }
    if (isManager || query.teamId || query.userId) {
      tpcCompletedWhere.OR = [
        ...(targetUserIds.length > 0
          ? [
              { assignedToId: { in: targetUserIds } },
              { assignedById: { in: targetUserIds } },
              { completedById: { in: targetUserIds } },
            ]
          : []),
        { tpc: { lead: leadScopedWhere } },
      ];
    }
    const tpcCompleted = await this.prisma.tPCUser.count({ where: tpcCompletedWhere });

    // 4. notAssignedTpcs count
    const notAssignedWhere: any = {
      assignments: {
        none: {},
      },
    };
    if (isManager || query.teamId || query.userId) {
      notAssignedWhere.lead = leadScopedWhere;
    }
    const notAssignedTpcs = await this.prisma.tPC.count({ where: notAssignedWhere });

    // Build main tPC where clause
    const tpcWhere: any = {};
    if (isManager || query.teamId || query.userId) {
      tpcWhere.OR = [
        { lead: leadScopedWhere },
        ...(targetUserIds.length > 0
          ? [
              {
                assignments: {
                  some: {
                    OR: [
                      { assignedToId: { in: targetUserIds } },
                      { assignedById: { in: targetUserIds } },
                      { completedById: { in: targetUserIds } },
                    ],
                  },
                },
              },
            ]
          : []),
      ];
    }

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'NOT_ASSIGNED') {
        tpcWhere.assignments = { none: {} };
      } else if (query.status === 'PENDING') {
        tpcWhere.assignments = { some: { status: 'PENDING' } };
      } else if (query.status === 'COMPLETED') {
        tpcWhere.assignments = { some: { status: 'COMPLETED' } };
      }
    }

    if (periodDateRange) {
      tpcWhere.OR = [
        ...(tpcWhere.OR || []),
        { assignments: { some: { assignedAt: periodDateRange } } },
        { createdAt: periodDateRange },
      ];
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      const searchConditions = [
        { lead: { firstName: { contains: q, mode: 'insensitive' as const } } },
        { lead: { lastName: { contains: q, mode: 'insensitive' as const } } },
        { lead: { phone: { contains: q, mode: 'insensitive' as const } } },
        { lead: { notes: { contains: q, mode: 'insensitive' as const } } },
        { assignments: { some: { assignedTo: { firstName: { contains: q, mode: 'insensitive' as const } } } } },
        { assignments: { some: { assignedTo: { lastName: { contains: q, mode: 'insensitive' as const } } } } },
      ];
      tpcWhere.AND = [
        ...(tpcWhere.AND || []),
        { OR: searchConditions },
      ];
    }

    const tpcs = await this.prisma.tPC.findMany({
      where: tpcWhere,
      include: {
        lead: {
          include: {
            assignments: {
              where: {
                status: 'ACTIVE',
                expiresAt: { gt: new Date() },
              },
              include: {
                user: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
        assignments: {
          include: {
            assignedBy: { select: { id: true, firstName: true, lastName: true } },
            assignedTo: { select: { id: true, firstName: true, lastName: true } },
            completedBy: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { assignedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      counts: {
        activeLeadsToday,
        tpcAssignedToday,
        tpcCompleted,
        notAssignedTpcs,
      },
      data: tpcs,
    };
  }

  async getTpcHistoryForLead(leadId: string, userId?: string) {
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { teamId: true, role: { select: { name: true } } },
      });
      const roleName = (user?.role?.name || '').toUpperCase();
      const isSuperAdmin = ['SUPER_ADMIN', 'SUPERADMIN', 'ADMIN'].includes(roleName);
      const isManager = ['MANAGER'].includes(roleName);

      if (!isSuperAdmin && !isManager) {
        throw new ForbiddenException('Access denied: You are not authorized to view TPC history');
      }

      if (isManager) {
        const managedTeams = await this.prisma.team.findMany({
          where: { managerId: userId, isActive: true },
          select: { id: true },
        });
        const allTeamIds = Array.from(new Set([...managedTeams.map((t) => t.id), ...(user?.teamId ? [user.teamId] : [])]));
        const teamMembers = await this.prisma.user.findMany({
          where: {
            OR: [
              ...(allTeamIds.length > 0 ? [{ teamId: { in: allTeamIds } }] : []),
              { managerId: userId },
              { id: userId },
            ],
          },
          select: { id: true },
        });
        const scopedUserIds = teamMembers.map((m) => m.id);

        const lead = await this.prisma.lead.findUnique({
          where: { id: leadId },
          include: { assignments: { where: { status: 'ACTIVE' } } },
        });
        if (!lead) {
          throw new NotFoundException('Lead not found');
        }

        const isLeadInScope =
          (lead.teamId && allTeamIds.includes(lead.teamId)) ||
          scopedUserIds.includes(lead.createdById) ||
          lead.assignments.some((a) => scopedUserIds.includes(a.userId));

        const tpc = await this.prisma.tPC.findFirst({
          where: { leadId },
          include: { assignments: true },
        });
        const hasTpcInScope = tpc?.assignments.some(
          (a) => scopedUserIds.includes(a.assignedToId) || scopedUserIds.includes(a.assignedById),
        );

        if (!isLeadInScope && !hasTpcInScope) {
          throw new ForbiddenException('Access denied: You cannot view history for this lead.');
        }
      }
    }

    const tpc = await this.prisma.tPC.findFirst({
      where: { leadId },
    });

    if (!tpc) {
      return [];
    }

    return this.prisma.tPCCall.findMany({
      where: {
        tpcUser: {
          tpcId: tpc.id,
        },
      },
      include: {
        caller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            role: { select: { name: true } },
          },
        },
        tpcUser: {
          select: {
            id: true,
            status: true,
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTpcHistoryForAssignment(assignmentId: string, userId?: string) {
    const assignment = await this.prisma.tPCUser.findUnique({
      where: { id: assignmentId },
      include: {
        tpc: {
          include: {
            lead: {
              include: { assignments: { where: { status: 'ACTIVE' } } },
            },
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('TPC assignment not found');
    }

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { teamId: true, role: { select: { name: true } } },
      });
      const roleName = (user?.role?.name || '').toUpperCase();
      const isSuperAdmin = ['SUPER_ADMIN', 'SUPERADMIN', 'ADMIN'].includes(roleName);
      const isManager = ['MANAGER'].includes(roleName);

      if (!isSuperAdmin && !isManager) {
        throw new ForbiddenException('Access denied: You are not authorized to view TPC history');
      }

      if (isManager) {
        const managedTeams = await this.prisma.team.findMany({
          where: { managerId: userId, isActive: true },
          select: { id: true },
        });
        const allTeamIds = Array.from(new Set([...managedTeams.map((t) => t.id), ...(user?.teamId ? [user.teamId] : [])]));
        const teamMembers = await this.prisma.user.findMany({
          where: {
            OR: [
              ...(allTeamIds.length > 0 ? [{ teamId: { in: allTeamIds } }] : []),
              { managerId: userId },
              { id: userId },
            ],
          },
          select: { id: true },
        });
        const scopedUserIds = teamMembers.map((m) => m.id);

        const lead = assignment.tpc?.lead;
        const isAssignmentInScope =
          scopedUserIds.includes(assignment.assignedToId) ||
          scopedUserIds.includes(assignment.assignedById) ||
          (assignment.completedById && scopedUserIds.includes(assignment.completedById)) ||
          (lead &&
            ((lead.teamId && allTeamIds.includes(lead.teamId)) ||
              scopedUserIds.includes(lead.createdById) ||
              lead.assignments.some((a) => scopedUserIds.includes(a.userId))));

        if (!isAssignmentInScope) {
          throw new ForbiddenException('Access denied: You cannot view history for this TPC assignment.');
        }
      }
    }

    return this.prisma.tPCCall.findMany({
      where: {
        tpcUser: {
          tpcId: assignment.tpcId,
        },
      },
      include: {
        caller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            role: { select: { name: true } },
          },
        },
        tpcUser: {
          select: {
            id: true,
            status: true,
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
