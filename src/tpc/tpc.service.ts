import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AssignTpcDto } from './dto/assign-tpc.dto';
import { UpdateTpcStatusDto } from './dto/update-tpc-status.dto';

@Injectable()
export class TpcService {
  constructor(private readonly prisma: PrismaService) { }

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
    });
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
              },
            },
          },
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
              },
            },
          },
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
              },
            },
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
        lead: true,
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
    const assignment = await this.prisma.tPCUser.findUnique({
      where: { id: assignmentId },
      include: { tpc: { include: { lead: true } } },
    });

    if (!assignment) {
      throw new NotFoundException('TPC assignment not found');
    }

    const isCompleted = dto.status === 'COMPLETED';

    const updated = await this.prisma.tPCUser.update({
      where: { id: assignmentId },
      data: {
        status: dto.status,
        completedById: isCompleted ? userId : null,
        completedAt: isCompleted ? new Date() : null,
      },
      include: {
        tpc: {
          include: {
            lead: {
              include: {
                status: true,
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

    await this.prisma.activityLog.create({
      data: {
        userId,
        activity: 'TPC',
        entityType: 'TPCUser',
        entityId: assignment.id,
        description: `Marked TPC assignment as ${dto.status} for lead ${assignment.tpc.lead.firstName}`,
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
}
