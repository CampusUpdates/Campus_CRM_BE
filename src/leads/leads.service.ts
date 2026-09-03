import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from 'src/prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadPipelineDto } from './dto/update-lead-pipeline.dto';
import { CollegeStatus } from '@prisma/client';


// CENTRALIZED SOURCE OF TRUTH FOR LEAD ASSIGNMENT ELIGIBILITY PREDICATE
export const buildAssignableLeadsWhere = (now: Date = new Date()) => ({
  status: {
    name: {
      in: ['LEAD', 'CANCELLED'],
    },
  },
  assignments: {
    none: {
      status: 'ACTIVE' as const,
      expiresAt: {
        gt: now,
      },
    },
  },
});

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateAndGetCollegePitches(tx: any, collegeIds: string[]) {
    const uniqueCollegeIds = Array.from(new Set(collegeIds));
    const colleges = await tx.college.findMany({
      where: { id: { in: uniqueCollegeIds } },
    });

    if (colleges.length !== uniqueCollegeIds.length) {
      throw new NotFoundException('One or more selected colleges were not found.');
    }

    for (const college of colleges) {
      if (!college.isActive || !college.hasTieUp) {
        throw new BadRequestException(
          'This college is not currently available for pitching.',
        );
      }
    }

    const collegeMap = new Map<string, typeof colleges[number]>();
    for (const college of colleges) {
      collegeMap.set(college.id, college);
    }
    return collegeMap;
  }

  private validatePitchApproval(pitch: { approvalStatus: CollegeStatus }) {
    if (pitch.approvalStatus === CollegeStatus.PENDING) {
      throw new BadRequestException(
        'This college pitch is awaiting manager approval. The pipeline cannot be changed until it is approved.',
      );
    }
    if (pitch.approvalStatus === CollegeStatus.REJECTED) {
      throw new BadRequestException(
        'This college pitch was rejected by the manager. Pipeline changes are not allowed.',
      );
    }
  }

  private async findResponsibleManagerId(
    tx: any,
    paUserId: string,
  ): Promise<string | null> {
    if (!tx?.user) return null;
    const paUser = await tx.user.findUnique({
      where: { id: paUserId },
      select: {
        managerId: true,
        team: {
          select: {
            managerId: true,
          },
        },
      },
    });

    if (paUser?.managerId) {
      return paUser.managerId;
    }
    if (paUser?.team?.managerId) {
      return paUser.team.managerId;
    }
    return null;
  }

  async create(createLeadDto: CreateLeadDto, userId: string) {
    let targetStatusId: number;
    if (createLeadDto.statusId) {
      const selectedStatus = await this.prisma.leadStatus.findUnique({
        where: { id: createLeadDto.statusId },
      });
      if (!selectedStatus || !selectedStatus.isActive) {
        throw new NotFoundException('Selected lead status not found');
      }
      targetStatusId = selectedStatus.id;
    } else {
      const defaultStatus = await this.prisma.leadStatus.findFirst({
        where: { name: 'LEAD' },
      });
      if (!defaultStatus || !defaultStatus.isActive) {
        throw new NotFoundException('Default LEAD status not found');
      }
      targetStatusId = defaultStatus.id;
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

    const { collegeIds, dateOfBirth: rawDob, statusId: _, ...leadData } = createLeadDto;
    const dateOfBirth = rawDob ? new Date(rawDob) : undefined;
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
              ...(dateOfBirth && { dateOfBirth }),
              statusId: targetStatusId,
            },
          })
        : await tx.lead.create({
            data: {
              ...leadData,
              ...(dateOfBirth && { dateOfBirth }),
              statusId: targetStatusId,
              createdById: userId,
            },
          });

      if (collegeIds && collegeIds.length > 0) {
        const uniqueCollegeIds = Array.from(new Set(collegeIds));
        const collegeMap = await this.validateAndGetCollegePitches(tx, uniqueCollegeIds);

        const creatorUser = tx.user
          ? await tx.user.findUnique({
              where: { id: userId },
              select: {
                firstName: true,
                lastName: true,
                role: { select: { name: true } },
              },
            })
          : null;

        const creatorRoleName = creatorUser?.role?.name ? creatorUser.role.name.toUpperCase() : '';
        const isExemptFromApproval = ['MANAGER', 'SUPER_ADMIN', 'SUPERADMIN', 'ADMIN', 'HR'].includes(creatorRoleName);

        await tx.leadCollege.createMany({
          data: uniqueCollegeIds.map((collegeId) => {
            const college = collegeMap.get(collegeId)!;
            const approvalStatus = isExemptFromApproval
              ? CollegeStatus.APPROVED
              : college.requiresApproval
              ? CollegeStatus.PENDING
              : CollegeStatus.APPROVED;

            return {
              leadId: lead.id,
              collegeId,
              statusId: targetStatusId,
              pitchedById: userId,
              processedById: isExemptFromApproval ? userId : null,
              approvalStatus,
            };
          }),
          skipDuplicates: true,
        });

        if (!isExemptFromApproval) {
          const managerId = await this.findResponsibleManagerId(tx, userId);
          if (managerId) {
            const paName = [creatorUser?.firstName, creatorUser?.lastName].filter(Boolean).join(' ') || 'Program Advisor';
            const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ');

            for (const collegeId of uniqueCollegeIds) {
              const college = collegeMap.get(collegeId)!;
              if (college.requiresApproval) {
                const notification = await tx.notification.create({
                  data: {
                    type: 'LEAD',
                    title: 'New College Pitch Approval',
                    message: `${paName} submitted ${leadName}'s pitch for ${college.name} for your approval.`,
                  },
                });

                await tx.notificationRecipient.create({
                  data: {
                    notificationId: notification.id,
                    userId: managerId,
                    isRead: false,
                  },
                });
              }
            }
          }
        }
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
          pitchedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      return {
        lead: {
          ...lead,
          collegeApplications,
        },
        assignment,
      };
    }, { timeout: 30000 });
  }

  async findAll(
    user: { sub: string; teamId?: number | null },
    scope: string = 'OWN',
  ) {
    let whereClause: any = {};

    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { teamId: true, role: { select: { name: true } } },
    });

    const roleName = userRecord?.role?.name || '';
    const userTeamId = userRecord?.teamId || user.teamId;

    // Find all teams managed by this user
    const managedTeams = await this.prisma.team.findMany({
      where: { managerId: user.sub, isActive: true },
      select: { id: true },
    });
    const managedTeamIds = managedTeams.map((t) => t.id);

    const normalizedRole = roleName.toUpperCase();
    const isManagerRole =
      normalizedRole.includes('MANAGER') || managedTeamIds.length > 0;

    const managedTeamMemberIds = await this.getManagerTeamMemberIds(user.sub);

    if (normalizedRole.includes('ADMIN') || scope === 'ALL') {
      whereClause = {};
    } else if (isManagerRole || scope === 'MANAGED') {
      const allTeamIds = [
        ...new Set([...managedTeamIds, ...(userTeamId ? [userTeamId] : [])]),
      ];

      whereClause = {
        OR: [
          { createdById: user.sub },
          ...(managedTeamMemberIds.length > 0
            ? [{ createdById: { in: managedTeamMemberIds } }]
            : []),
          ...(allTeamIds.length > 0
            ? [{ createdBy: { teamId: { in: allTeamIds } } }]
            : []),
          {
            assignments: {
              some: {
                user: {
                  OR: [
                    ...(allTeamIds.length > 0 ? [{ teamId: { in: allTeamIds } }] : []),
                    { id: user.sub },
                    { managerId: user.sub },
                  ],
                },
              },
            },
          },
        ],
      };
    } else if (scope === 'TEAM') {
      whereClause = {
        OR: [
          { createdById: user.sub },
          ...(userTeamId ? [{ createdBy: { teamId: userTeamId } }] : []),
          ...(userTeamId ? [{ assignments: { some: { user: { teamId: userTeamId } } } }] : []),
          { assignments: { some: { userId: user.sub } } },
        ],
      };
    } else {
      // DEFAULT: 'OWN'
      whereClause = {
        OR: [
          { createdById: user.sub },
          {
            assignments: {
              some: {
                userId: user.sub,
              },
            },
          },
        ],
      };
    }

    return this.prisma.lead.findMany({
      where: whereClause,
      include: {
        status: true,
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignments: {
          orderBy: {
            assignedAt: 'desc',
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                teamId: true,
                team: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },


        collegeApplications: {
          include: {
            college: true,
            status: true,
            pitchedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            processedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });
  }

  async update(
    leadId: string,
    updateLeadDto: UpdateLeadDto,
    user: { sub: string; teamId?: number | null },
    scope: string = 'OWN',
  ) {
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(leadId)) {
      throw new NotFoundException('Lead not found');
    }
    const now = new Date();
    const lead = await this.prisma.lead.findUnique({
      where: {
        id: leadId,
      },
      include: {
        assignments: {
          where: {
            status: 'ACTIVE',
            expiresAt: {
              gt: now,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                teamId: true,
              },
            },
          },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (scope !== 'ALL') {
      const latestAssignment = await this.prisma.leadAssignment.findFirst({
        where: { leadId },
        orderBy: { assignedAt: 'desc' },
      });
      if (
        latestAssignment &&
        (latestAssignment.status !== 'ACTIVE' ||
          (latestAssignment.expiresAt && latestAssignment.expiresAt.getTime() <= now.getTime()))
      ) {
        throw new ForbiddenException(
          'Lead assignment has expired. Actions are disabled.',
        );
      }
    }

    const activeAssignment = lead.assignments[0];

    const isCreator = lead.createdById === user.sub;
    const isAssigned = activeAssignment?.userId === user.sub;
    const isSameTeam =
      scope === 'TEAM' &&
      user.teamId &&
      activeAssignment?.user?.teamId === user.teamId;

    if (scope !== 'ALL' && !isCreator && !isAssigned && !isSameTeam) {
      throw new ForbiddenException(
        'You do not have permission to update this lead.',
      );
    }


    const { collegeIds, ...leadData } = updateLeadDto;

    return this.prisma.$transaction(async (tx) => {
      const updatedLead = await tx.lead.update({
        where: {
          id: leadId,
        },
        data: leadData,
        include: {
          status: true,
        },
      });

      if (collegeIds !== undefined) {
        if (collegeIds.length === 0) {
          throw new BadRequestException(
            'At least one college must be selected for the lead.',
          );
        }

        // Find existing pitches to avoid duplicate insertion (preserve historical LeadCollege applications)
        const existingPitches = await tx.leadCollege.findMany({
          where: { leadId },
          select: { collegeId: true },
        });

        const existingCollegeIds = new Set(existingPitches.map((p) => p.collegeId));
        const newCollegeIds = Array.from(new Set(collegeIds)).filter(
          (id) => !existingCollegeIds.has(id),
        );

        if (newCollegeIds.length > 0) {
          const collegeMap = await this.validateAndGetCollegePitches(tx, newCollegeIds);

          const creatorUser = tx.user
            ? await tx.user.findUnique({
                where: { id: user.sub },
                select: {
                  firstName: true,
                  lastName: true,
                  role: { select: { name: true } },
                },
              })
            : null;

          const creatorRoleName = creatorUser?.role?.name ? creatorUser.role.name.toUpperCase() : '';
          const isExemptFromApproval = ['MANAGER', 'SUPER_ADMIN', 'SUPERADMIN', 'ADMIN', 'HR'].includes(creatorRoleName);

          await tx.leadCollege.createMany({
            data: newCollegeIds.map((collegeId) => {
              const college = collegeMap.get(collegeId)!;
              const approvalStatus = isExemptFromApproval
                ? CollegeStatus.APPROVED
                : college.requiresApproval
                ? CollegeStatus.PENDING
                : CollegeStatus.APPROVED;

              return {
                leadId,
                collegeId,
                statusId: updatedLead.statusId,
                pitchedById: user.sub,
                processedById: isExemptFromApproval ? user.sub : null,
                approvalStatus,
              };
            }),
            skipDuplicates: true,
          });

          if (!isExemptFromApproval) {
            const managerId = await this.findResponsibleManagerId(tx, user.sub);
            if (managerId) {
              const paName = [creatorUser?.firstName, creatorUser?.lastName].filter(Boolean).join(' ') || 'Program Advisor';
              const leadName = [updatedLead.firstName, updatedLead.lastName].filter(Boolean).join(' ');

              for (const collegeId of newCollegeIds) {
                const college = collegeMap.get(collegeId)!;
                if (college.requiresApproval) {
                  const notification = await tx.notification.create({
                    data: {
                      type: 'LEAD',
                      title: 'New College Pitch Approval',
                      message: `${paName} submitted ${leadName}'s pitch for ${college.name} for your approval.`,
                    },
                  });

                  await tx.notificationRecipient.create({
                    data: {
                      notificationId: notification.id,
                      userId: managerId,
                      isRead: false,
                    },
                  });
                }
              }
            }
          }
        }
      }

      const collegeApplications = await tx.leadCollege.findMany({
        where: { leadId },
        include: {
          college: true,
          status: true,
          pitchedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          processedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      return {
        ...updatedLead,
        collegeApplications,
      };
    }, { timeout: 30000 });
  }

  async findOne(
    leadId: string,
    user: { sub: string; teamId?: number | null },
    scope: string = 'OWN',
  ) {
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(leadId)) {
      throw new NotFoundException('Lead not found');
    }
    const now = new Date();
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
              gt: now,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                teamId: true,
                managerId: true,
              },
            },
          },
        },
        collegeApplications: {
          include: {
            college: true,
            status: true,
            pitchedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
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
        tpcs: {
          include: {
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
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { teamId: true, role: { select: { name: true } } },
    });

    const roleName = userRecord?.role?.name || '';
    const userTeamId = userRecord?.teamId || user.teamId;

    const managedTeamMemberIds = await this.getManagerTeamMemberIds(user.sub);
    const managedTeams = await this.prisma.team.findMany({
      where: { managerId: user.sub, isActive: true },
      select: { id: true },
    });
    const managedTeamIds = managedTeams.map((t) => t.id);

    const normalizedRole = roleName.toUpperCase();
    const isManagerRole =
      normalizedRole.includes('MANAGER') || managedTeamIds.length > 0;
    const isAdminRole =
      normalizedRole.includes('ADMIN') || normalizedRole === 'HR';

    if (isAdminRole || scope === 'ALL') {
      return lead;
    }

    const isCreator = lead.createdById === user.sub;
    const isAssignedToUser = lead.assignments.some((a) => a.userId === user.sub);
    const isAssignedToTeamMember = lead.assignments.some(
      (a) =>
        a.user?.teamId &&
        (a.user.teamId === userTeamId || managedTeamIds.includes(a.user.teamId)),
    );
    const isAssignedToManagedUser = lead.assignments.some(
      (a) => managedTeamMemberIds.includes(a.userId) || a.user?.managerId === user.sub,
    );
    const isCreatedByManagedUser = lead.createdById
      ? managedTeamMemberIds.includes(lead.createdById)
      : false;

    if (isManagerRole || scope === 'MANAGED') {
      if (
        isCreator ||
        isAssignedToUser ||
        isAssignedToTeamMember ||
        isAssignedToManagedUser ||
        isCreatedByManagedUser
      ) {
        return lead;
      }
      throw new ForbiddenException('You do not have access to team leads.');
    }

    if (scope === 'TEAM') {
      if (isCreator || isAssignedToUser || isAssignedToTeamMember) {
        return lead;
      }
      throw new ForbiddenException('You do not have access to team leads.');
    }

    // Default 'OWN' scope
    if (isCreator || isAssignedToUser) {
      return lead;
    }

    throw new ForbiddenException('You do not have access to this lead.');
  }

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
            pitchedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
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



  // CENTRALIZED SOURCE OF TRUTH FOR LEAD ASSIGNMENT ELIGIBILITY
  evaluateLeadEligibility(
    lead: any,
    now: Date = new Date(),
  ): {
    isEligible: boolean;
    reason?: string;
    errorCode?: 'PERMANENT' | 'ACTIVE_WINDOW' | 'PROTECTED';
    expiresAt?: Date;
  } {
    const statusName = lead?.status?.name || '';

    // 1. ADMISSION_DONE -> Permanently Non-Assignable
    if (statusName === 'ADMISSION_DONE') {
      return {
        isEligible: false,
        reason: 'Leads with completed admission cannot be assigned or reassigned.',
        errorCode: 'PERMANENT',
      };
    }

    // 2. Active 4-Day Assignment Window Protection
    const activeAssignment = lead?.assignments?.find(
      (a: any) =>
        a.status === 'ACTIVE' &&
        new Date(a.expiresAt).getTime() > now.getTime(),
    );

    if (activeAssignment) {
      return {
        isEligible: false,
        reason:
          'This lead is currently inside an active 4-day assignment window and cannot be reassigned.',
        errorCode: 'ACTIVE_WINDOW',
        expiresAt: new Date(activeAssignment.expiresAt),
      };
    }

    // 3. Protected Pipeline Statuses
    const protectedStatuses = [
      'APPLICATION',
      'INTERVIEW_SCHEDULED',
      'INTERVIEW_DONE',
      'LETTER_OUT',
    ];

    if (protectedStatuses.includes(statusName)) {
      return {
        isEligible: false,
        reason: 'This lead has progressed in the pipeline and cannot be reassigned.',
        errorCode: 'PROTECTED',
      };
    }

    // 4. Reusable Statuses (LEAD / CANCELLED) with no active window
    const reusableStatuses = ['LEAD', 'CANCELLED'];
    if (reusableStatuses.includes(statusName)) {
      return {
        isEligible: true,
      };
    }

    // 5. Default fallback for unhandled or ineligible statuses
    return {
      isEligible: false,
      reason: 'This lead is not eligible for assignment.',
    };
  }

  async claim(leadId: string, userId: string) {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Concurrency protection: lock lead row
      await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${leadId}::uuid FOR UPDATE`;

      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        include: {
          status: true,
          assignments: {
            orderBy: { assignedAt: 'desc' },
          },
        },
      });

      if (!lead) {
        throw new NotFoundException('Lead not found');
      }

      const eligibility = this.evaluateLeadEligibility(lead, now);

      if (!eligibility.isEligible) {
        if (eligibility.errorCode === 'PERMANENT') {
          throw new ForbiddenException(
            'Leads with completed admission cannot be assigned or reassigned.',
          );
        } else if (eligibility.errorCode === 'ACTIVE_WINDOW') {
          throw new ConflictException(
            'This lead is currently inside an active 4-day assignment window and cannot be reassigned.',
          );
        } else if (eligibility.errorCode === 'PROTECTED') {
          throw new ConflictException(
            'This lead has progressed in the pipeline and cannot be reassigned.',
          );
        } else {
          throw new ConflictException(
            eligibility.reason || 'This lead is not eligible for assignment.',
          );
        }
      }

      await tx.leadAssignment.updateMany({
        where: {
          leadId,
          status: 'ACTIVE',
          expiresAt: { lte: now },
        },
        data: {
          status: 'EXPIRED',
        },
      });

      const expiresAt = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

      const assignment = await tx.leadAssignment.create({
        data: {
          leadId,
          userId,
          assignedAt: now,
          expiresAt,
          status: 'ACTIVE',
        },
      });

      await tx.activityLog.create({
        data: {
          userId,
          activity: 'LEAD',
          entityType: 'LEAD',
          entityId: leadId,
          description: 'Lead claimed',
        },
      });

      return {
        message: 'Lead claimed successfully',
        leadId,
        assignment,
      };
    }, { timeout: 30000 });
  }

  async assignLead(
    leadId: string,
    targetUserId: string,
    managerUser: { sub: string; teamId?: number | null },
  ) {
    const now = new Date();

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });

    if (!targetUser || targetUser.status !== 'ACTIVE') {
      throw new NotFoundException('Target user not found or is inactive.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Concurrency protection: lock lead row
      await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${leadId}::uuid FOR UPDATE`;

      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        include: {
          status: true,
          assignments: {
            orderBy: { assignedAt: 'desc' },
          },
        },
      });

      if (!lead) {
        throw new NotFoundException('Lead not found');
      }

      const eligibility = this.evaluateLeadEligibility(lead, now);

      if (!eligibility.isEligible) {
        if (eligibility.errorCode === 'PERMANENT') {
          throw new ForbiddenException(
            'Leads with completed admission cannot be assigned or reassigned.',
          );
        } else if (eligibility.errorCode === 'ACTIVE_WINDOW') {
          throw new ConflictException(
            'This lead is currently inside an active 4-day assignment window and cannot be reassigned.',
          );
        } else if (eligibility.errorCode === 'PROTECTED') {
          throw new ConflictException(
            'This lead has progressed in the pipeline and cannot be reassigned.',
          );
        } else {
          throw new ConflictException(
            eligibility.reason || 'This lead is not eligible for assignment.',
          );
        }
      }

      await tx.leadAssignment.updateMany({
        where: {
          leadId,
          status: 'ACTIVE',
          expiresAt: { lte: now },
        },
        data: {
          status: 'EXPIRED',
        },
      });

      const expiresAt = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

      const assignment = await tx.leadAssignment.create({
        data: {
          leadId,
          userId: targetUserId,
          assignedAt: now,
          expiresAt,
          status: 'ACTIVE',
        },
      });

      await tx.activityLog.create({
        data: {
          userId: managerUser.sub,
          activity: 'LEAD',
          entityType: 'LEAD',
          entityId: leadId,
          description: `Lead manually assigned to user ${targetUserId}`,
        },
      });

      return {
        message: 'Lead assigned successfully',
        leadId,
        assignment,
      };
    }, { timeout: 30000 });
  }

  async assignBulkLeads(
    dto: { quantity: number; targetUserId: string; teamId?: number },
    managerUser: { sub: string; teamId?: number | null },
  ) {
    const { quantity, targetUserId, teamId } = dto;
    const now = new Date();

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });

    if (!targetUser || targetUser.status !== 'ACTIVE') {
      throw new NotFoundException('Target user not found or is inactive.');
    }

    return this.prisma.$transaction(async (tx) => {
      const assignableWhere: any = buildAssignableLeadsWhere(now);

      if (teamId) {
        assignableWhere.assignments = {
          some: { user: { teamId } },
          none: { status: 'ACTIVE', expiresAt: { gt: now } },
        };
      }

      const candidateLeads = await tx.lead.findMany({
        where: assignableWhere,
        include: {
          status: true,
          assignments: {
            orderBy: { assignedAt: 'desc' },
          },
        },
      });

      const eligibleLeads = candidateLeads.filter(
        (lead) => this.evaluateLeadEligibility(lead, now).isEligible,
      );

      const priority1Expired: typeof eligibleLeads = [];
      const priority2NeverAssigned: typeof eligibleLeads = [];

      for (const lead of eligibleLeads) {
        if (lead.assignments && lead.assignments.length > 0) {
          priority1Expired.push(lead);
        } else {
          priority2NeverAssigned.push(lead);
        }
      }

      // PRIORITY 1: Oldest expired assignment first (expiresAt ASC)
      priority1Expired.sort((a, b) => {
        const aExpiry = a.assignments[0]?.expiresAt
          ? new Date(a.assignments[0].expiresAt).getTime()
          : 0;
        const bExpiry = b.assignments[0]?.expiresAt
          ? new Date(b.assignments[0].expiresAt).getTime()
          : 0;
        return aExpiry - bExpiry;
      });

      // PRIORITY 2: Never assigned created earliest first (createdAt ASC)
      priority2NeverAssigned.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      const combinedPool = [...priority1Expired, ...priority2NeverAssigned];
      const selectedLeads = combinedPool.slice(0, quantity);

      const assignedResults: any[] = [];
      const expiresAt = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

      for (const lead of selectedLeads) {
        await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${lead.id}::uuid FOR UPDATE`;

        const currentCheck = await tx.lead.findUnique({
          where: { id: lead.id },
          include: {
            status: true,
            assignments: { orderBy: { assignedAt: 'desc' } },
          },
        });

        if (!currentCheck || !this.evaluateLeadEligibility(currentCheck, now).isEligible) {
          continue;
        }

        await tx.leadAssignment.updateMany({
          where: {
            leadId: lead.id,
            status: 'ACTIVE',
            expiresAt: { lte: now },
          },
          data: { status: 'EXPIRED' },
        });

        const newAssignment = await tx.leadAssignment.create({
          data: {
            leadId: lead.id,
            userId: targetUserId,
            assignedAt: now,
            expiresAt,
            status: 'ACTIVE',
          },
        });

        assignedResults.push(newAssignment);
      }

      await tx.activityLog.create({
        data: {
          userId: managerUser.sub,
          activity: 'LEAD',
          entityType: 'LEAD_ASSIGNMENT',
          entityId: targetUserId,
          description: `Bulk assigned ${assignedResults.length} leads to user ${targetUserId}`,
        },
      });

      return {
        message: `Successfully assigned ${assignedResults.length} lead(s)`,
        requestedQuantity: quantity,
        assignedCount: assignedResults.length,
        assignments: assignedResults,
      };
    }, { timeout: 30000 });
  }

  async getAssignableLeadsCount(
    user: { sub: string; teamId?: number | null },
  ) {
    const now = new Date();

    const count = await this.prisma.lead.count({
      where: buildAssignableLeadsWhere(now),
    });

    return {
      assignableCount: count,
    };
  }

  async getManagerTeamMemberIds(
    managerUserId: string,
    tx: any = this.prisma,
  ): Promise<string[]> {
    if (!tx?.team || !tx?.user) return [];
    const managedTeams = await tx.team.findMany({
      where: { managerId: managerUserId, isActive: true },
      select: { id: true },
    });

    const targetTeamIds = managedTeams.map((t: any) => t.id);

    const teamMembers = await tx.user.findMany({
      where: {
        OR: [
          ...(targetTeamIds.length > 0 ? [{ teamId: { in: targetTeamIds } }] : []),
          { managerId: managerUserId },
        ],
      },
      select: { id: true },
    });

    return teamMembers.map((m: any) => m.id);
  }

  async getPitchApprovals(
    managerUser: { sub: string; teamId?: number | null },
    scope: string = 'TEAM',
    statusFilter?: CollegeStatus,
  ) {
    const whereClause: any = {};

    if (statusFilter && (statusFilter as string) !== 'ALL') {
      whereClause.approvalStatus = statusFilter;
    }

    if (scope === 'TEAM') {
      const memberIds = await this.getManagerTeamMemberIds(managerUser.sub);
      whereClause.pitchedById = { in: memberIds };
    }

    return this.prisma.leadCollege.findMany({
      where: whereClause,
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            city: true,
            state: true,
          },
        },
        college: {
          select: {
            id: true,
            name: true,
          },
        },
        pitchedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        processedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async processPitchApproval(
    pitchId: string,
    status: CollegeStatus,
    managerUser: { sub: string; teamId?: number | null },
    scope: string = 'TEAM',
  ) {
    const pitch = await this.prisma.leadCollege.findUnique({
      where: { id: pitchId },
      include: {
        pitchedBy: {
          select: {
            id: true,
            teamId: true,
            firstName: true,
          },
        },
        college: {
          select: {
            name: true,
          },
        },
        lead: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!pitch) {
      throw new NotFoundException('Lead college pitch request not found');
    }

    // Duplicate protection: only transition PENDING -> APPROVED or PENDING -> REJECTED
    if (pitch.approvalStatus !== CollegeStatus.PENDING) {
      return pitch;
    }

    if (scope === 'TEAM') {
      const memberIds = await this.getManagerTeamMemberIds(managerUser.sub);
      if (!memberIds.includes(pitch.pitchedById)) {
        throw new ForbiddenException(
          'You can only process pitch requests for your team members.',
        );
      }
    }

    const studentName = [pitch.lead.firstName, pitch.lead.lastName]
      .filter(Boolean)
      .join(' ');
    const collegeName = pitch.college.name;

    const title =
      status === CollegeStatus.APPROVED
        ? 'College Pitch Approved'
        : 'College Pitch Rejected';

    const message =
      status === CollegeStatus.APPROVED
        ? `Your pitch for ${studentName} at ${collegeName} has been approved.`
        : `Your pitch for ${studentName} at ${collegeName} has been rejected.`;

    return this.prisma.$transaction(async (tx) => {
      const updatedPitch = await tx.leadCollege.update({
        where: { id: pitchId },
        data: {
          approvalStatus: status,
          processedById: managerUser.sub,
        },
      });

      const notification = await tx.notification.create({
        data: {
          type: 'LEAD',
          title,
          message,
        },
      });

      await tx.notificationRecipient.create({
        data: {
          notificationId: notification.id,
          userId: pitch.pitchedById,
          isRead: false,
        },
      });

      await tx.activityLog.create({
        data: {
          userId: managerUser.sub,
          activity: 'LEAD',
          entityType: 'LEAD_COLLEGE',
          entityId: pitchId,
          description: `Pitch request ${status.toLowerCase()} for lead ${studentName}`,
        },
      });

      return updatedPitch;
    }, { timeout: 30000 });
  }

  async updatePipeline(
    leadId: string,
    dto: UpdateLeadPipelineDto,
    user: { sub: string; teamId?: number | null },
    scope: string = 'OWN',
  ) {
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(leadId)) {
      throw new NotFoundException('Lead not found');
    }
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // 1. Re-fetch Lead with assignments and current status
      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        include: {
          status: true,
          assignments: {
            where: {
              status: 'ACTIVE',
              expiresAt: { gt: now },
            },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  teamId: true,
                },
              },
            },
          },
          collegeApplications: {
            include: {
              college: true,
              status: true,
            },
          },
        },
      });

      if (!lead) {
        throw new NotFoundException('Lead not found');
      }

      // Check access scope
      const activeAssignment = lead.assignments[0];
      const isCreator = lead.createdById === user.sub;
      const isAssigned = activeAssignment?.userId === user.sub;
      const isSameTeam =
        scope === 'TEAM' &&
        user.teamId &&
        activeAssignment?.user?.teamId === user.teamId;

      if (scope !== 'ALL' && !isCreator && !isAssigned && !isSameTeam) {
        throw new ForbiddenException(
          'You do not have permission to update pipeline status for this lead.',
        );
      }

      // 2. Re-fetch target LeadStatus by statusId
      const targetStatus = await tx.leadStatus.findUnique({
        where: { id: dto.statusId },
      });

      if (!targetStatus || !targetStatus.isActive) {
        throw new NotFoundException('Target LeadStatus not found or inactive');
      }

      const statusName = targetStatus.name.toUpperCase();
      let relevantLeadCollege: any = null;
      let activityDescription = `Lead status changed to ${targetStatus.name}`;

      // 3. Process Status-Specific Pipeline Requirements
      if (statusName === 'APPLICATION') {
        if (!dto.collegeId || !dto.applicationId) {
          throw new BadRequestException(
            'collegeId and applicationId are required when changing status to APPLICATION',
          );
        }

        const college = await tx.college.findUnique({
          where: { id: dto.collegeId },
        });
        if (!college) {
          throw new NotFoundException('College not found');
        }

        // Check for existing application for leadId + collegeId
        const existingApp = await tx.leadCollege.findFirst({
          where: {
            leadId,
            collegeId: dto.collegeId,
          },
        });

        if (existingApp) {
          this.validatePitchApproval(existingApp);
          if (existingApp.applicationId) {
            throw new ConflictException(
              `An application for ${college.name} already exists for this lead`,
            );
          }
          relevantLeadCollege = await tx.leadCollege.update({
            where: { id: existingApp.id },
            data: {
              applicationId: dto.applicationId,
              statusId: targetStatus.id,
            },
          });
        } else {
          if (!college.isActive || !college.hasTieUp) {
            throw new BadRequestException(
              'This college is not currently available for pitching.',
            );
          }
          relevantLeadCollege = await tx.leadCollege.create({
            data: {
              leadId,
              collegeId: dto.collegeId,
              applicationId: dto.applicationId,
              statusId: targetStatus.id,
              pitchedById: user.sub,
              approvalStatus: college.requiresApproval
                ? CollegeStatus.PENDING
                : CollegeStatus.APPROVED,
            },
          });
        }

        activityDescription = `Lead moved to APPLICATION for ${college.name} (App ID: ${dto.applicationId})`;
      } else if (statusName === 'INTERVIEW_SCHEDULED') {
        if (!dto.collegeId || !dto.interview?.scheduledAt) {
          throw new BadRequestException(
            'collegeId and interview.scheduledAt are required for INTERVIEW_SCHEDULED',
          );
        }

        relevantLeadCollege = await tx.leadCollege.findFirst({
          where: { leadId, collegeId: dto.collegeId },
          include: { college: true },
        });

        if (!relevantLeadCollege) {
          throw new NotFoundException(
            'LeadCollege application not found for the selected college',
          );
        }

        this.validatePitchApproval(relevantLeadCollege);

        // Check if an existing interview exists (rescheduling support)
        const previousInterview = await tx.leadCollegeInterview.findFirst({
          where: { leadCollegeId: relevantLeadCollege.id, status: 'SCHEDULED' },
          orderBy: { createdAt: 'desc' },
        });

        if (previousInterview) {
          await tx.leadCollegeInterview.update({
            where: { id: previousInterview.id },
            data: { status: 'RESCHEDULED' },
          });
        }

        await tx.leadCollegeInterview.create({
          data: {
            leadCollegeId: relevantLeadCollege.id,
            interviewerId: dto.interview.interviewerId || null,
            scheduledAt: new Date(dto.interview.scheduledAt),
            status: 'SCHEDULED',
            result: 'PENDING',
            rescheduledFromId: previousInterview?.id || null,
          },
        });

        await tx.leadCollege.update({
          where: { id: relevantLeadCollege.id },
          data: { statusId: targetStatus.id },
        });

        activityDescription = `Interview scheduled for ${relevantLeadCollege.college.name}`;
      } else if (statusName === 'INTERVIEW_DONE') {
        if (!dto.collegeId || !dto.interviewResult?.result) {
          throw new BadRequestException(
            'collegeId and interviewResult.result are required for INTERVIEW_DONE',
          );
        }

        relevantLeadCollege = await tx.leadCollege.findFirst({
          where: { leadId, collegeId: dto.collegeId },
          include: { college: true },
        });

        if (!relevantLeadCollege) {
          throw new NotFoundException(
            'LeadCollege application not found for the selected college',
          );
        }

        this.validatePitchApproval(relevantLeadCollege);

        const existingInterview = await tx.leadCollegeInterview.findFirst({
          where: { leadCollegeId: relevantLeadCollege.id },
          orderBy: { createdAt: 'desc' },
        });

        const interviewResultVal =
          (dto.interviewResult.result.toUpperCase() as any) || 'PASSED';

        if (existingInterview) {
          await tx.leadCollegeInterview.update({
            where: { id: existingInterview.id },
            data: {
              status: 'COMPLETED',
              result: interviewResultVal,
              feedback: dto.interviewResult.feedback || null,
              conductedAt: dto.interviewResult.conductedAt
                ? new Date(dto.interviewResult.conductedAt)
                : new Date(),
            },
          });
        } else {
          await tx.leadCollegeInterview.create({
            data: {
              leadCollegeId: relevantLeadCollege.id,
              scheduledAt: new Date(),
              conductedAt: dto.interviewResult.conductedAt
                ? new Date(dto.interviewResult.conductedAt)
                : new Date(),
              status: 'COMPLETED',
              result: interviewResultVal,
              feedback: dto.interviewResult.feedback || null,
            },
          });
        }

        await tx.leadCollege.update({
          where: { id: relevantLeadCollege.id },
          data: { statusId: targetStatus.id },
        });

        activityDescription = `Interview completed for ${relevantLeadCollege.college.name} (Result: ${interviewResultVal})`;
      } else if (statusName === 'LETTER_OUT') {
        if (
          !dto.collegeId ||
          !dto.selectionLetter?.issuedAt ||
          !dto.selectionLetter?.admissionLastDate
        ) {
          throw new BadRequestException(
            'collegeId, selectionLetter.issuedAt, and selectionLetter.admissionLastDate are required for LETTER_OUT',
          );
        }

        relevantLeadCollege = await tx.leadCollege.findFirst({
          where: { leadId, collegeId: dto.collegeId },
          include: { college: true },
        });

        if (!relevantLeadCollege) {
          throw new NotFoundException(
            'LeadCollege application not found for the selected college',
          );
        }

        this.validatePitchApproval(relevantLeadCollege);

        await tx.selectionLetter.create({
          data: {
            leadCollegeId: relevantLeadCollege.id,
            issuedAt: new Date(dto.selectionLetter.issuedAt),
            admissionLastDate: new Date(
              dto.selectionLetter.admissionLastDate,
            ),
            letterUrl: dto.selectionLetter.letterUrl || null,
            issuedById: user.sub,
          },
        });

        await tx.leadCollege.update({
          where: { id: relevantLeadCollege.id },
          data: { statusId: targetStatus.id },
        });

        activityDescription = `Selection letter issued for ${relevantLeadCollege.college.name}`;
      } else if (statusName === 'ADMISSION_DONE') {
        if (
          !dto.collegeId ||
          dto.admission?.amount === undefined ||
          dto.admission?.amount === null
        ) {
          throw new BadRequestException(
            'collegeId and admission.amount are required for ADMISSION_DONE',
          );
        }

        relevantLeadCollege = await tx.leadCollege.findFirst({
          where: { leadId, collegeId: dto.collegeId },
          include: { college: true },
        });

        if (!relevantLeadCollege) {
          throw new NotFoundException(
            'LeadCollege application not found for the selected college',
          );
        }

        this.validatePitchApproval(relevantLeadCollege);

        await tx.leadCollegePayment.create({
          data: {
            leadCollegeId: relevantLeadCollege.id,
            type: 'ADMISSION_FEE',
            amount: dto.admission.amount,
            paymentMode: dto.admission.paymentMode || 'ONLINE',
            transactionRef: dto.admission.transactionRef || null,
            paidAt: dto.admission.paidAt
              ? new Date(dto.admission.paidAt)
              : new Date(),
            processedById: user.sub,
          },
        });

        await tx.leadCollege.update({
          where: { id: relevantLeadCollege.id },
          data: { statusId: targetStatus.id },
        });

        // Set Lead.finalCollegeId to the selected college
        await tx.lead.update({
          where: { id: leadId },
          data: {
            statusId: targetStatus.id,
            finalCollegeId: dto.collegeId,
          },
        });

        activityDescription = `Admission completed at ${relevantLeadCollege.college.name} with payment of ₹${dto.admission.amount}`;
      } else if (statusName === 'CANCELLED') {
        if (!dto.collegeId || !dto.cancellation?.reason) {
          throw new BadRequestException(
            'collegeId and cancellation.reason are required for CANCELLED',
          );
        }

        relevantLeadCollege = await tx.leadCollege.findFirst({
          where: { leadId, collegeId: dto.collegeId },
          include: { college: true },
        });

        if (!relevantLeadCollege) {
          throw new NotFoundException(
            'LeadCollege application not found for the selected college',
          );
        }

        this.validatePitchApproval(relevantLeadCollege);

        await tx.leadCollege.update({
          where: { id: relevantLeadCollege.id },
          data: {
            statusId: targetStatus.id,
            isCancelled: true,
            cancelledAt: new Date(),
            cancellationReason: dto.cancellation.reason,
          },
        });

        activityDescription = `Application cancelled for ${relevantLeadCollege.college.name}. Reason: ${dto.cancellation.reason}`;
      } else {
        // LEAD or generic global status update
        if (dto.collegeId) {
          relevantLeadCollege = await tx.leadCollege.findFirst({
            where: { leadId, collegeId: dto.collegeId },
            include: { college: true },
          });

          if (relevantLeadCollege) {
            this.validatePitchApproval(relevantLeadCollege);
            await tx.leadCollege.update({
              where: { id: relevantLeadCollege.id },
              data: { statusId: targetStatus.id },
            });
          }
        }
      }

      // Update Lead.statusId globally (if not already updated by ADMISSION_DONE)
      if (statusName !== 'ADMISSION_DONE') {
        await tx.lead.update({
          where: { id: leadId },
          data: { statusId: targetStatus.id },
        });
      }

      // Create LeadCollegeHistory audit record
      if (relevantLeadCollege) {
        await tx.leadCollegeHistory.create({
          data: {
            leadCollegeId: relevantLeadCollege.id,
            fromStatusId: lead.statusId,
            toStatusId: targetStatus.id,
            changedById: user.sub,
            remarks:
              dto.cancellation?.reason ||
              dto.interviewResult?.feedback ||
              null,
          },
        });
      }

      // Create ActivityLog audit record
      await tx.activityLog.create({
        data: {
          userId: user.sub,
          activity: 'LEAD',
          entityType: relevantLeadCollege ? 'LEAD_COLLEGE' : 'LEAD',
          entityId: relevantLeadCollege?.id || leadId,
          description: activityDescription,
        },
      });

      // Re-fetch and return updated Lead details with complete journey history
      return tx.lead.findUnique({
        where: { id: leadId },
        include: {
          status: true,
          finalCollege: true,
          collegeApplications: {
            include: {
              college: true,
              status: true,
              interviews: { orderBy: { createdAt: 'desc' } },
              selectionLetters: { orderBy: { createdAt: 'desc' } },
              payments: { orderBy: { createdAt: 'desc' } },
              history: { orderBy: { createdAt: 'desc' } },
            },
          },
        },
      });
    }, { timeout: 30000 });
  }
}

