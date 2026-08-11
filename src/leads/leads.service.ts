import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from 'src/prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto'
@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

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

    const now = new Date();

    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 4);

    return this.prisma.$transaction(async (tx) => {
      let lead;

      if (existingLead) {
        lead = await tx.lead.update({
          where: {
            id: existingLead.id,
          },
          data: {
            ...createLeadDto,
            statusId: leadStatus.id,
          },
        });
      } else {
        lead = await tx.lead.create({
          data: {
            ...createLeadDto,
            statusId: leadStatus.id,
            createdById: userId,
          },
        });
      }

      const assignment = await tx.leadAssignment.create({
        data: {
          leadId: lead.id,
          userId,
          assignedAt: now,
          expiresAt,
          status: 'ACTIVE',
        },
      });

      return {
        lead,
        assignment,
      };
    });
  }

  async update(
  leadId: string,
  updateLeadDto: UpdateLeadDto,
  userId: string,
) {
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
    throw new ForbiddenException(
      'You do not have access to this lead.',
    );
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
}