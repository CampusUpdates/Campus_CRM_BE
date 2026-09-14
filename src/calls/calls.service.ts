import {
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

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('TelephonyProvider')
    private readonly telephonyProvider: any,
  ) {}

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

    for (const assignment of activeAssignments) {
      for (const item of assignment.items) {
        if (!item.studentData || seenStudentIds.has(item.studentData.id)) {
          continue;
        }
        seenStudentIds.add(item.studentData.id);

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

    return {
      items: queueItems,
      totalAssigned: queueItems.length,
    };
  }

  async getAssignedStudentDataOne(
    studentDataId: string,
    advisorUserId: string,
  ) {
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
          where: {
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
      !studentData.assignmentItems ||
      studentData.assignmentItems.length === 0
    ) {
      throw new ForbiddenException(
        'Access denied: Student data record is not currently assigned to you.',
      );
    }

    return {
      ...studentData,
      activeAssignment: studentData.assignmentItems[0].assignment,
    };
  }

  async initiateMockCall(studentDataId: string, advisorUserId: string) {
    const student = await this.getAssignedStudentDataOne(
      studentDataId,
      advisorUserId,
    );
    const session = await this.telephonyProvider.initiateCall(student.phone);

    await this.prisma.activityLog
      .create({
        data: {
          userId: advisorUserId,
          activity: 'SYSTEM',
          entityType: 'StudentData',
          entityId: studentDataId,
          description:
            `Initiated mock call to ${student.firstName} ${student.lastName || ''}`.trim(),
        },
      })
      .catch(() => {});

    return {
      session,
      student,
    };
  }

  async endMockCall(callId: string, advisorUserId: string) {
    const session = await this.telephonyProvider.endCall(callId);

    await this.prisma.activityLog
      .create({
        data: {
          userId: advisorUserId,
          activity: 'SYSTEM',
          entityType: 'MockCall',
          entityId: callId,
          description: `Ended mock call (${session.durationSeconds || 0}s duration)`,
        },
      })
      .catch(() => {});

    return session;
  }

  async getMockCallStatus(callId: string) {
    return this.telephonyProvider.getCallStatus(callId);
  }
}
