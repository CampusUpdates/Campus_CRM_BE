import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import type {
  TelephonyProvider,
  CallSession,
} from './interfaces/telephony-provider.interface';
import { DataAssignmentStatus } from '@prisma/client';
import { CreateCallOutcomeDto } from './dto/create-call-outcome.dto';
import { GetCallLogsDto } from './dto/get-call-logs.dto';
import {
  normalizePhone,
  getPhoneQueryCandidates,
} from '../common/utils/phone.util';

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly teamLeadAuthService?: TeamLeadAuthorizationService,
    @Inject('TelephonyProvider')
    @Optional()
    private readonly telephonyProvider?: any,
  ) { }

  async getCallQueue(advisorUserId: string) {
    const activeAssignments = await this.prisma.dataAssignment.findMany({
      where: {
        assignedToId: advisorUserId,
        status: DataAssignmentStatus.ACTIVE,
      },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: {
            studentData: {
              include: {
                upload: {
                  select: {
                    id: true,
                    fileName: true,
                    uploadedAt: true,
                  },
                },
                category: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [
        { assignedAt: 'asc' },
        { id: 'asc' },
      ],
    });

    const queueItems: any[] = [];
    const seenStudentIds = new Set<string>();
    const studentDataIds: string[] = [];

    for (const assignment of activeAssignments) {
      for (const item of assignment.items) {
        if (!item.studentData || seenStudentIds.has(item.studentData.id)) {
          continue;
        }
        seenStudentIds.add(item.studentData.id);
        studentDataIds.push(item.studentData.id);

        queueItems.push({
          studentDataId: item.studentData.id,
          firstName: item.studentData.firstName,
          middleName: item.studentData.middleName,
          lastName: item.studentData.lastName,
          phone: item.studentData.phone,
          email: item.studentData.email,
          city: item.studentData.city,
          state: item.studentData.state,
          createdAt: item.studentData.createdAt,
          category: item.studentData.category,
          upload: item.studentData.upload,
          assignment: {
            id: assignment.id,
            assignedAt: assignment.assignedAt,
            expiresAt: assignment.expiresAt,
            status: assignment.status,
          },
        });
      }
    }

    // Query CallRecords created by THIS advisor for studentData in queue
    const completedRecords =
      studentDataIds.length > 0
        ? await this.prisma.callRecord.findMany({
          where: {
            createdById: advisorUserId,
            studentDataId: { in: studentDataIds },
          },
          select: { studentDataId: true },
        })
        : [];

    const completedSet = new Set(completedRecords.map((r) => r.studentDataId));

    let firstUncompletedIndex = -1;
    let completedCount = 0;

    for (let i = 0; i < queueItems.length; i++) {
      const isCompleted = completedSet.has(queueItems[i].studentDataId);
      queueItems[i].isCompleted = isCompleted;
      if (isCompleted) {
        completedCount++;
      } else if (firstUncompletedIndex === -1) {
        firstUncompletedIndex = i;
      }
    }

    const initialIndex =
      firstUncompletedIndex !== -1 ? firstUncompletedIndex : queueItems.length;

    return {
      items: queueItems,
      totalAssigned: queueItems.length,
      completedCount,
      initialIndex,
    };
  }

  private async isSuperAdminOrManager(
    userId: string,
    roleId?: number,
  ): Promise<boolean> {
    if (roleId === 1 || roleId === 3) {
      return true;
    }
    if (!this.prisma.user?.findUnique) {
      return false;
    }
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: { select: { id: true, name: true } } },
      });
      if (user?.role?.id === 1 || user?.role?.id === 3) {
        return true;
      }
      const roleName = user?.role?.name?.toUpperCase() || '';
      return (
        roleName.includes('SUPER_ADMIN') ||
        roleName.includes('MANAGER') ||
        roleName.includes('ADMIN')
      );
    } catch {
      return false;
    }
  }

  async canUserAccessStudentData(
    studentDataId: string,
    userId: string,
    roleId?: number,
  ): Promise<boolean> {
    const isAdminOrManager = await this.isSuperAdminOrManager(userId, roleId);
    if (isAdminOrManager) {
      const exists = await this.prisma.studentData.findUnique({
        where: { id: studentDataId },
        select: { id: true },
      });
      return !!exists;
    }

    const isTeamLead = this.teamLeadAuthService
      ? await this.teamLeadAuthService.isTeamLead(userId)
      : false;

    if (isTeamLead && this.teamLeadAuthService) {
      const supervisedAdvisorIds =
        await this.teamLeadAuthService.getTeamLeadAdvisorIds(userId);
      const authorizedUserIds = [userId, ...supervisedAdvisorIds];

      const count = await this.prisma.studentData.count({
        where: {
          id: studentDataId,
          OR: [
            {
              assignmentItems: {
                some: {
                  assignment: {
                    assignedToId: { in: authorizedUserIds },
                    status: DataAssignmentStatus.ACTIVE,
                  },
                },
              },
            },
            {
              callRecords: {
                some: { createdById: { in: authorizedUserIds } },
              },
            },
          ],
        },
      });
      return count > 0;
    }

    const count = await this.prisma.studentData.count({
      where: {
        id: studentDataId,
        OR: [
          {
            assignmentItems: {
              some: {
                assignment: {
                  assignedToId: userId,
                  status: DataAssignmentStatus.ACTIVE,
                },
              },
            },
          },
          {
            callRecords: {
              some: { createdById: userId },
            },
          },
        ],
      },
    });
    return count > 0;
  }

  async getCallLogs(
    dto: GetCallLogsDto,
    userId: string,
    roleId?: number,
  ) {
    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(dto.limit) || 10));
    const skip = (page - 1) * limit;

    const isAdminOrManager = await this.isSuperAdminOrManager(userId, roleId);
    const isTeamLead = this.teamLeadAuthService
      ? await this.teamLeadAuthService.isTeamLead(userId)
      : false;

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(0, 0, 0, 0);

    let roleWhereCondition: any = {};

    if (isAdminOrManager) {
      roleWhereCondition = {
        callRecords: { some: { createdAt: { gte: twoDaysAgo } } },
      };
    } else if (isTeamLead && this.teamLeadAuthService) {
      const supervisedAdvisorIds =
        await this.teamLeadAuthService.getTeamLeadAdvisorIds(userId);
      const authorizedUserIds = [userId, ...supervisedAdvisorIds];

      roleWhereCondition = {
        callRecords: {
          some: {
            createdById: { in: authorizedUserIds },
            createdAt: { gte: twoDaysAgo },
          },
        },
      };
    } else {
      roleWhereCondition = {
        callRecords: {
          some: {
            createdById: userId,
            createdAt: { gte: twoDaysAgo },
          },
        },
      };
    }

    const whereConditions: any[] = [roleWhereCondition];

    if (dto.search && dto.search.trim().length > 0) {
      const searchTerm = dto.search.trim();
      const parts = searchTerm.split(/\s+/).filter(Boolean);

      const searchOrs: any[] = [
        { firstName: { contains: searchTerm, mode: 'insensitive' } },
        { lastName: { contains: searchTerm, mode: 'insensitive' } },
        { phone: { contains: searchTerm, mode: 'insensitive' } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
        { state: { contains: searchTerm, mode: 'insensitive' } },
      ];

      if (parts.length > 1) {
        searchOrs.push({
          AND: [
            { firstName: { contains: parts[0], mode: 'insensitive' } },
            { lastName: { contains: parts[parts.length - 1], mode: 'insensitive' } },
          ],
        });
      }

      whereConditions.push({ OR: searchOrs });
    }

    const finalWhere = { AND: whereConditions };

    const candidateStudents = await this.prisma.studentData.findMany({
      where: finalWhere,
      select: {
        id: true,
        callRecords: {
          where: { createdAt: { gte: twoDaysAgo } },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { outcome: true, createdAt: true },
        },
      },
    });

    const nowTime = Date.now();
    const twentyFourHoursAgo = new Date(nowTime - 24 * 60 * 60 * 1000);

    const bookmarkedStudentIds: string[] = candidateStudents
      .filter((student) => {
        const latestCall = student.callRecords[0];
        if (!latestCall) return false;
        const outcomeStr = String(latestCall.outcome || '').toUpperCase();
        const isBookmarkOutcome =
          outcomeStr === 'FOLLOW_UP' ||
          outcomeStr === 'CALL_BACK_LATER' ||
          outcomeStr === 'FOLLOW_UP_REQUIRED';
        return isBookmarkOutcome && new Date(latestCall.createdAt) >= twentyFourHoursAgo;
      })
      .map((student) => student.id);

    const bookmarkedCount = bookmarkedStudentIds.length;

    let total = candidateStudents.length;
    let queryWhere: any = finalWhere;

    if (dto.bookmarkedOnly) {
      total = bookmarkedCount;
      queryWhere = {
        AND: [finalWhere, { id: { in: bookmarkedStudentIds } }],
      };
    }

    const studentRecords = await this.prisma.studentData.findMany({
      where: queryWhere,
      skip,
      take: limit,
      include: {
        upload: {
          select: {
            id: true,
            fileName: true,
            uploadedAt: true,
          },
        },
        callRecords: {
          where: { createdAt: { gte: twoDaysAgo } },
          include: {
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = studentRecords.map((student) => {
      const latestCall = student.callRecords[0] || null;
      let isBookmarked = false;
      let bookmarkExpiresAt: string | null = null;

      if (latestCall) {
        const outcomeStr = String(latestCall.outcome || '').toUpperCase();
        const isBookmarkOutcome =
          outcomeStr === 'FOLLOW_UP' ||
          outcomeStr === 'CALL_BACK_LATER' ||
          outcomeStr === 'FOLLOW_UP_REQUIRED';

        if (isBookmarkOutcome) {
          const createdAtTime = new Date(latestCall.createdAt).getTime();
          const expiresAtTime = createdAtTime + 24 * 60 * 60 * 1000;
          if (expiresAtTime > nowTime) {
            isBookmarked = true;
            bookmarkExpiresAt = new Date(expiresAtTime).toISOString();
          }
        }
      }

      const fullName = [student.firstName, student.middleName, student.lastName]
        .filter(Boolean)
        .join(' ');

      return {
        studentDataId: student.id,
        firstName: student.firstName,
        middleName: student.middleName,
        lastName: student.lastName,
        fullName,
        phone: student.phone,
        email: student.email,
        city: student.city,
        state: student.state,
        uploadFileName: student.upload?.fileName || 'Data Upload',
        totalCalls: student.callRecords.length,
        latestCall: latestCall
          ? {
            id: latestCall.id,
            outcome: latestCall.outcome,
            notes: latestCall.notes,
            startedAt: latestCall.startedAt,
            endedAt: latestCall.endedAt,
            durationSeconds: latestCall.durationSeconds,
            createdAt: latestCall.createdAt,
            createdBy: latestCall.createdBy,
          }
          : null,
        isBookmarked,
        bookmarkExpiresAt,
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      bookmarkedCount,
    };
  }

  async getAssignedStudentDataOne(
    studentDataId: string,
    advisorUserId: string,
    roleId?: number,
  ) {
    const isAdminOrManager = await this.isSuperAdminOrManager(
      advisorUserId,
      roleId,
    );

    const studentData = await this.prisma.studentData.findUnique({
      where: { id: studentDataId },
      include: {
        upload: {
          select: {
            id: true,
            fileName: true,
            uploadedAt: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        assignmentItems: {
          where: isAdminOrManager
            ? { assignment: { status: DataAssignmentStatus.ACTIVE } }
            : {
              assignment: {
                assignedToId: advisorUserId,
                status: DataAssignmentStatus.ACTIVE,
              },
            },
          include: {
            assignment: {
              select: {
                id: true,
                assignedToId: true,
                assignedAt: true,
                expiresAt: true,
                status: true,
              },
            },
          },
        },
        callRecords: {
          where: { createdById: advisorUserId },
          select: { id: true },
        },
      },
    });

    if (!studentData) {
      throw new NotFoundException('Student data record not found.');
    }

    if (!isAdminOrManager) {
      const isAssignedToUser =
        studentData.assignmentItems && studentData.assignmentItems.length > 0;
      const hasCallRecords =
        studentData.callRecords && studentData.callRecords.length > 0;

      let isSupervisedAdvisor = false;
      if (!isAssignedToUser && !hasCallRecords && this.teamLeadAuthService) {
        const isTeamLead = await this.teamLeadAuthService.isTeamLead(advisorUserId);
        if (isTeamLead) {
          const supervisedAdvisorIds =
            await this.teamLeadAuthService.getTeamLeadAdvisorIds(advisorUserId);
          if (supervisedAdvisorIds.length > 0) {
            const supervisedCheck = await this.prisma.studentData.findFirst({
              where: {
                id: studentDataId,
                OR: [
                  {
                    assignmentItems: {
                      some: {
                        assignment: {
                          assignedToId: { in: supervisedAdvisorIds },
                          status: DataAssignmentStatus.ACTIVE,
                        },
                      },
                    },
                  },
                  {
                    callRecords: {
                      some: { createdById: { in: supervisedAdvisorIds } },
                    },
                  },
                ],
              },
              select: { id: true },
            });
            isSupervisedAdvisor = !!supervisedCheck;
          }
        }
      }

      if (!isAssignedToUser && !hasCallRecords && !isSupervisedAdvisor) {
        throw new ForbiddenException(
          'Access denied: Student data record is not currently assigned to you.',
        );
      }
    }

    return {
      ...studentData,
      activeAssignment: studentData.assignmentItems[0]?.assignment || null,
    };
  }

  async initiateMockCall(
    studentDataId: string,
    advisorUserId: string,
    roleId?: number,
  ) {
    const student = await this.getAssignedStudentDataOne(
      studentDataId,
      advisorUserId,
      roleId,
    );
    const session = await this.telephonyProvider.initiateCall(student.phone);

    await this.prisma.activityLog
      .create({
        data: {
          userId: advisorUserId,
          activity: 'SYSTEM',
          entityType: 'StudentData',
          entityId: studentDataId,
          description: `Initiated mock call session ${session.callId} to phone ${student.phone}`,
        },
      })
      .catch(() => undefined);

    return {
      session: {
        callId: session.callId,
        phoneNumber: session.phoneNumber,
        status: session.status,
        startedAt: session.startedAt,
        connectedAt: session.connectedAt,
        durationSeconds: session.durationSeconds || 0,
      },
      student: {
        studentDataId: student.id,
        firstName: student.firstName,
        middleName: student.middleName,
        lastName: student.lastName,
        phone: student.phone,
        email: student.email,
      },
    };
  }

  async endMockCall(sessionId: string, advisorUserId: string) {
    const session = await this.telephonyProvider.endCall(sessionId);

    await this.prisma.activityLog
      .create({
        data: {
          userId: advisorUserId,
          activity: 'SYSTEM',
          entityType: 'CallSession',
          entityId: sessionId,
          description: `Ended mock call session ${sessionId}`,
        },
      })
      .catch(() => undefined);

    return session;
  }

  async getMockCallStatus(sessionId: string) {
    return this.telephonyProvider.getCallStatus(sessionId);
  }

  async createCallOutcome(
    dto: CreateCallOutcomeDto,
    advisorUserId: string,
    roleId?: number,
  ) {
    // 1. Verify studentData is assigned to the advisor (or user is Admin/Manager)
    const studentData = await this.getAssignedStudentDataOne(
      dto.studentDataId,
      advisorUserId,
      roleId,
    );

    // 2. Validate referenced leadId if provided
    if (dto.leadId) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: dto.leadId },
        select: { id: true, phone: true },
      });

      if (!lead) {
        throw new NotFoundException('Referenced lead not found.');
      }

      if (
        studentData.phone &&
        lead.phone &&
        normalizePhone(studentData.phone) !== normalizePhone(lead.phone)
      ) {
        throw new BadRequestException(
          'Referenced lead is not associated with this student data contact.',
        );
      }
    }

    // 3. Validate endedAt >= startedAt when both are supplied
    if (dto.startedAt && dto.endedAt) {
      const start = new Date(dto.startedAt);
      const end = new Date(dto.endedAt);
      if (end.getTime() < start.getTime()) {
        throw new BadRequestException('endedAt cannot be before startedAt.');
      }
    }

    // 4. Validate durationSeconds is not negative
    if (
      dto.durationSeconds !== undefined &&
      dto.durationSeconds !== null &&
      dto.durationSeconds < 0
    ) {
      throw new BadRequestException('durationSeconds cannot be negative.');
    }

    // 5. Create and return CallRecord
    return this.prisma.callRecord.create({
      data: {
        studentDataId: dto.studentDataId,
        leadId: dto.leadId ?? null,
        createdById: advisorUserId,
        outcome: dto.outcome,
        notes: dto.notes ? dto.notes.trim() : null,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
        endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
        durationSeconds: dto.durationSeconds ?? null,
      },
    });
  }

  async getCallHistory(
    studentDataId: string,
    advisorUserId: string,
    roleId?: number,
  ) {
    const isAdminOrManager = await this.isSuperAdminOrManager(
      advisorUserId,
      roleId,
    );

    let targetStudent: { id: string; phone?: string | null } | null = null;

    if (isAdminOrManager) {
      targetStudent = await this.prisma.studentData.findUnique({
        where: { id: studentDataId },
        select: { id: true, phone: true },
      });
      if (!targetStudent) {
        throw new NotFoundException('Student data record not found.');
      }
    } else {
      const assigned = await this.getAssignedStudentDataOne(
        studentDataId,
        advisorUserId,
        roleId,
      );
      targetStudent = { id: assigned.id, phone: assigned.phone };
    }

    const normPhone = normalizePhone(targetStudent.phone);
    if (!normPhone || normPhone.length < 10) {
      return this.prisma.callRecord.findMany({
        where: { studentDataId },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          studentData: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              category: {
                select: {
                  id: true,
                  name: true,
                },
              },
              upload: {
                select: {
                  id: true,
                  fileName: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    const phoneCandidates = getPhoneQueryCandidates(normPhone);

    const [matchingStudents, matchingLeads] = await Promise.all([
      this.prisma.studentData.findMany({
        where: {
          phone: { in: phoneCandidates },
        },
        select: { id: true, phone: true },
      }),
      this.prisma.lead.findMany({
        where: {
          phone: { in: phoneCandidates },
        },
        select: { id: true, phone: true },
      }),
    ]);

    const matchingStudentIds = matchingStudents
      .filter((s) => normalizePhone(s.phone) === normPhone)
      .map((s) => s.id);

    if (!matchingStudentIds.includes(studentDataId)) {
      matchingStudentIds.push(studentDataId);
    }

    const matchingLeadIds = matchingLeads
      .filter((l) => normalizePhone(l.phone) === normPhone)
      .map((l) => l.id);

    return this.prisma.callRecord.findMany({
      where: {
        OR: [
          { studentDataId: { in: matchingStudentIds } },
          ...(matchingLeadIds.length > 0
            ? [{ leadId: { in: matchingLeadIds } }]
            : []),
        ],
      },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        studentData: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            category: {
              select: {
                id: true,
                name: true,
              },
            },
            upload: {
              select: {
                id: true,
                fileName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
