import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from 'src/prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createLeadDto: CreateLeadDto, userId: string) {
    const leadStatus = await this.prisma.leadStatus.findUnique({
      where: {
        name: 'LEAD',
      },
    });

    if (!leadStatus || !leadStatus.isActive) {
      throw new NotFoundException('LEAD status not found');
    }

    const existingLead = await this.prisma.lead.findFirst({
      where: {
        phone: createLeadDto.phone,
      },
      include: {
        assignments: {
          where: {
            status: 'ACTIVE',
            expiresAt: {
              gt: new Date(),
            },
          },
        },
      },
    });

    if (existingLead && existingLead.assignments.length > 0) {
      throw new ConflictException(
        'This lead is already assigned to another user.',
      );
    }

    const { collegeIds, ...leadData } = createLeadDto;

    const now = new Date();

    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 4);

    return this.prisma.$transaction(async (tx) => {
      const lead = existingLead
        ? await tx.lead.update({
            where: {
              id: existingLead.id,
            },
            data: {
              ...leadData,
              statusId: leadStatus.id,
            },
          })
        : await tx.lead.create({
            data: {
              ...leadData,
              statusId: leadStatus.id,
              createdById: userId,
            },
          });

      if (collegeIds && collegeIds.length > 0) {
        const uniqueCollegeIds = Array.from(new Set(collegeIds));
        await tx.leadCollege.createMany({
          data: uniqueCollegeIds.map((collegeId) => ({
            leadId: lead.id,
            collegeId,
            statusId: leadStatus.id,
            processedById: null,
          })),
          skipDuplicates: true,
        });
      }

      await tx.activityLog.create({
        data: {
          userId,
          activity: 'LEAD',
          entityType: 'LEAD',
          entityId: lead.id,
          description: 'Lead created',
        },
      });

      const assignment = await tx.leadAssignment.create({
        data: {
          leadId: lead.id,
          userId,
          assignedAt: now,
          expiresAt,
          status: 'ACTIVE',
        },
      });

      const collegeApplications = await tx.leadCollege.findMany({
        where: {
          leadId: lead.id,
        },
        include: {
          college: true,
          status: true,
        },
      });

      return {
        lead: {
          ...lead,
          collegeApplications,
        },
        assignment,
      };
    });
  }

  async update(leadId: string, updateLeadDto: UpdateLeadDto, userId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: {
        id: leadId,
      },
      include: {
        assignments: {
          where: {
            status: 'ACTIVE',
            expiresAt: {
              gt: new Date(),
            },
          },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const activeAssignment = lead.assignments[0];

    if (!activeAssignment || activeAssignment.userId !== userId) {
      throw new ConflictException(
        'You do not have access to update this lead.',
      );
    }

    return this.prisma.lead.update({
      where: {
        id: leadId,
      },
      data: updateLeadDto,
    });
  }

  //find by lead id

  async findOne(leadId: string, userId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: {
        id: leadId,
      },
      include: {
        status: true,
        assignments: {
          where: {
            status: 'ACTIVE',
            expiresAt: {
              gt: new Date(),
            },
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
              },
            },
          },
        },
        collegeApplications: {
          include: {
            college: true,
            status: true,
            processedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
              },
            },
          },
        },
        interactions: true,
        tpcs: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const activeAssignment = lead.assignments[0];

    if (!activeAssignment || activeAssignment.userId !== userId) {
      throw new ForbiddenException('You do not have access to this lead.');
    }

    return lead;
  }

  //search lead using phone
  async searchByPhone(phone: string) {
    const lead = await this.prisma.lead.findFirst({
      where: {
        phone,
      },
      include: {
        status: true,
        collegeApplications: {
          include: {
            college: true,
            status: true,
            processedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
              },
            },
          },
        },
        assignments: {
          where: {
            status: 'ACTIVE',
            expiresAt: {
              gt: new Date(),
            },
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
              },
            },
          },
        },
      },
    });

    if (!lead) {
      return {
        exists: false,
      };
    }

    return {
      exists: true,
      leadId: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      status: lead.status,
      activeAssignment: lead.assignments[0] ?? null,
      collegeApplications: lead.collegeApplications,
    };
  }
  //business rule-001 only lead and cancelled can be claimed
  async claim(leadId: string, userId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: {
        id: leadId,
      },
      include: {
        status: true,
        assignments: {
          where: {
            status: 'ACTIVE',
            expiresAt: {
              gt: new Date(),
            },
          },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    // Someone currently owns the lead
    if (lead.assignments.length > 0) {
      throw new ConflictException(
        'This lead is currently assigned to another user.',
      );
    }

    // Only LEAD and CANCELLED can be claimed again
    const reusableStatuses = ['LEAD', 'CANCELLED'];

    if (!reusableStatuses.includes(lead.status.name)) {
      throw new ForbiddenException(
        'This lead cannot be accessed by you.',
      );
    }

    const now = new Date();

    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 4);

    return this.prisma.$transaction(async (tx) => {
      // Mark previous expired assignments as EXPIRED
      await tx.leadAssignment.updateMany({
        where: {
          leadId,
          status: 'ACTIVE',
          expiresAt: {
            lte: now,
          },
        },
        data: {
          status: 'EXPIRED',
        },
      });

      // Create new 4-day ownership
      const assignment = await tx.leadAssignment.create({
        data: {
          leadId,
          userId,
          assignedAt: now,
          expiresAt,
          status: 'ACTIVE',
        },
      });

      return {
        message: 'Lead claimed successfully',
        leadId,
        assignment,
      };
    });
  }
}
