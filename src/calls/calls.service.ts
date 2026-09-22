import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  TelephonyProvider,
  CallSession,
} from './interfaces/telephony-provider.interface';
import { DataAssignmentStatus } from '@prisma/client';
import { CreateCallOutcomeDto } from './dto/create-call-outcome.dto';

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('TelephonyProvider')
    private readonly telephonyProvider: any,
  ) { }

  async getCallQueue(advisorUserId: string) {
    const activeAssignments = await this.prisma.dataAssignment.findMany({
      where: {
        assignedToId: advisorUserId,
        status: DataAssignmentStatus.ACTIVE,
      },
      include: {
        items: {
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
              },
            },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
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
                assignedAt: true,
                expiresAt: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!studentData) {
      throw new NotFoundException('Student data record not found.');
    }

    if (
      !isAdminOrManager &&
      (!studentData.assignmentItems || studentData.assignmentItems.length === 0)
    ) {
      throw new ForbiddenException(
        'Access denied: Student data record is not currently assigned to you.',
      );
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

      if (studentData.phone && lead.phone && studentData.phone !== lead.phone) {
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

    if (isAdminOrManager) {
      const studentData = await this.prisma.studentData.findUnique({
        where: { id: studentDataId },
        select: { id: true },
      });
      if (!studentData) {
        throw new NotFoundException('Student data record not found.');
      }
    } else {
      await this.getAssignedStudentDataOne(
        studentDataId,
        advisorUserId,
        roleId,
      );
    }

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
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
