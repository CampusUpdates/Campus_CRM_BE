import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadPipelineDto } from './dto/update-lead-pipeline.dto';
import { CollegeStatus, ClaimRequestStatus, OwnershipChangeReason } from '@prisma/client';
import { ProcessClaimRequestDto } from './dto/process-claim-request.dto';
import { QueryClaimRequestDto } from './dto/query-claim-request.dto';


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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) { }

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
        'College pipeline cannot be changed until Manager approval is completed.',
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

      await tx.leadOwnershipHistory.create({
        data: {
          leadId: lead.id,
          previousOwnerId: null,
          newOwnerId: userId,
          changedById: userId,
          reason: 'INITIAL_ASSIGNMENT',
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

      const previousOwnerId = lead.assignments[0]?.userId || lead.createdById;

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

      await tx.leadOwnershipHistory.create({
        data: {
          leadId,
          previousOwnerId: previousOwnerId || null,
          newOwnerId: targetUserId,
          changedById: managerUser.sub,
          reason: 'ADMIN_REASSIGNMENT',
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

      const assigner = await tx.user.findUnique({
        where: { id: managerUser.sub },
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
          title: 'New Lead Assigned',
          message: `${assignerName} assigned you a lead for calling: ${leadName}.`,
          type: 'LEAD',
          recipientUserIds: [targetUserId],
        },
        tx,
      );

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

        const previousOwnerId = currentCheck.assignments[0]?.userId || currentCheck.createdById;

        const newAssignment = await tx.leadAssignment.create({
          data: {
            leadId: lead.id,
            userId: targetUserId,
            assignedAt: now,
            expiresAt,
            status: 'ACTIVE',
          },
        });

        await tx.leadOwnershipHistory.create({
          data: {
            leadId: lead.id,
            previousOwnerId: previousOwnerId || null,
            newOwnerId: targetUserId,
            changedById: managerUser.sub,
            reason: 'ADMIN_REASSIGNMENT',
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

      if (assignedResults.length > 0) {
        const assigner = await tx.user.findUnique({
          where: { id: managerUser.sub },
          select: { firstName: true, lastName: true },
        });
        const assignerName = assigner
          ? [assigner.firstName, assigner.lastName].filter(Boolean).join(' ')
          : 'Manager';

        await this.notificationsService.createNotification(
          {
            title: 'New Lead Assigned',
            message: `${assignerName} assigned you ${assignedResults.length} lead(s) for calling.`,
            type: 'LEAD',
            recipientUserIds: [targetUserId],
          },
          tx,
        );
      }

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

      // Fetch user role info for forward-only check and approval exemptions
      const userRecord = await tx.user.findUnique({
        where: { id: user.sub },
        include: { role: true },
      });
      const userRoleName = userRecord?.role?.name ? userRecord.role.name.toUpperCase() : '';
      const isExemptRole = ['MANAGER', 'SUPER_ADMIN', 'SUPERADMIN', 'ADMIN', 'HR'].includes(userRoleName);
      const isProgramAdvisor = userRoleName === 'PROGRAM_ADVISOR' || !isExemptRole;

      const targetCollegeId = dto.collegeId || (lead.collegeApplications.length === 1 ? lead.collegeApplications[0].collegeId : null);
      const existingLeadCollege = targetCollegeId
        ? lead.collegeApplications.find((app) => app.collegeId === targetCollegeId) || null
        : null;

      if (existingLeadCollege) {
        this.validatePitchApproval(existingLeadCollege);

        if (isProgramAdvisor && existingLeadCollege.status) {
          if (targetStatus.displayOrder < existingLeadCollege.status.displayOrder) {
            throw new BadRequestException(
              'Program Advisors cannot move pipeline status backwards.',
            );
          }
        }
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
          include: { status: true },
        });

        if (existingApp) {
          this.validatePitchApproval(existingApp);
          if (isProgramAdvisor && existingApp.status) {
            if (targetStatus.displayOrder < existingApp.status.displayOrder) {
              throw new BadRequestException(
                'Program Advisors cannot move pipeline status backwards.',
              );
            }
          }
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

          const approvalStatus = isExemptRole
            ? CollegeStatus.APPROVED
            : college.requiresApproval
              ? CollegeStatus.PENDING
              : CollegeStatus.APPROVED;

          if (approvalStatus === CollegeStatus.PENDING) {
            await tx.leadCollege.create({
              data: {
                leadId,
                collegeId: dto.collegeId,
                applicationId: dto.applicationId,
                statusId: lead.statusId,
                pitchedById: user.sub,
                approvalStatus: CollegeStatus.PENDING,
              },
            });

            const managerId = await this.findResponsibleManagerId(tx, user.sub);
            if (managerId) {
              const paName = [userRecord?.firstName, userRecord?.lastName].filter(Boolean).join(' ') || 'Program Advisor';
              const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ');
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

            throw new BadRequestException(
              'College pipeline cannot be changed until Manager approval is completed.',
            );
          }

          relevantLeadCollege = await tx.leadCollege.create({
            data: {
              leadId,
              collegeId: dto.collegeId,
              applicationId: dto.applicationId,
              statusId: targetStatus.id,
              pitchedById: user.sub,
              approvalStatus: CollegeStatus.APPROVED,
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

  async getLead360Profile(leadId: string, userId: string) {
    // 1. Authorization check: Must be SUPER_ADMIN, MANAGER, PROGRAM_ADVISOR, HR, or active team manager
    const callingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!callingUser || !callingUser.role) {
      throw new UnauthorizedException('User profile not found');
    }

    const roleName = callingUser.role.name.toUpperCase();
    const isAllowedRole =
      roleName.includes('SUPER_ADMIN') ||
      roleName.includes('MANAGER') ||
      roleName.includes('PROGRAM_ADVISOR') ||
      roleName.includes('ADVISOR') ||
      roleName.includes('HR');

    if (!isAllowedRole) {
      const managedTeamsCount = await this.prisma.team.count({
        where: { managerId: userId, isActive: true },
      });
      if (managedTeamsCount === 0) {
        throw new ForbiddenException(
          'Access denied: You do not have permission to view the Lead Profile.',
        );
      }
    }

    // 2. Fetch Lead with all nested relations
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: { select: { name: true } },
          },
        },
        status: true,
        finalCollege: true,
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: { select: { name: true } },
              },
            },
          },
          orderBy: { assignedAt: 'desc' },
        },
        tpcs: {
          include: {
            assignments: {
              include: {
                assignedBy: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
                assignedTo: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
                completedBy: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
              },
              orderBy: { assignedAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        interactions: {
          include: {
            createdBy: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
            attachments: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        collegeApplications: {
          include: {
            college: true,
            status: true,
            pitchedBy: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
            processedBy: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
            interviews: {
              orderBy: { scheduledAt: 'desc' },
            },
            selectionLetters: {
              include: {
                issuedBy: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
              },
              orderBy: { issuedAt: 'desc' },
            },
            payments: {
              include: {
                processedBy: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
              },
              orderBy: { paidAt: 'desc' },
            },
            history: {
              include: {
                fromStatus: true,
                toStatus: true,
                changedBy: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID ${leadId} not found.`);
    }

    // 3. Fetch Data Origin (StudentData & DataUpload) by matching phone or email
    let dataOrigin: any = null;
    if (lead.phone || lead.email) {
      const studentData = await this.prisma.studentData.findFirst({
        where: {
          OR: [
            ...(lead.phone ? [{ phone: lead.phone }] : []),
            ...(lead.email ? [{ email: lead.email }] : []),
          ],
        },
        include: {
          upload: {
            include: {
              uploadedBy: {
                select: { id: true, firstName: true, lastName: true, email: true, role: { select: { name: true } } },
              },
            },
          },
          assignmentItems: {
            include: {
              assignment: {
                include: {
                  assignedBy: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
                  assignedTo: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
                },
              },
            },
            orderBy: { assignment: { assignedAt: 'desc' } },
          },
        },
      });

      if (studentData) {
        const latestAssignment = studentData.assignmentItems[0]?.assignment;
        dataOrigin = {
          studentDataId: studentData.id,
          fileName: studentData.upload?.fileName || 'Bulk Data Upload',
          fileUrl: studentData.upload?.fileUrl || null,
          uploadedAt: studentData.upload?.uploadedAt || studentData.createdAt,
          uploadedBy: studentData.upload?.uploadedBy
            ? {
              id: studentData.upload.uploadedBy.id,
              name: `${studentData.upload.uploadedBy.firstName} ${studentData.upload.uploadedBy.lastName || ''}`.trim(),
              role: studentData.upload.uploadedBy.role?.name || 'User',
            }
            : null,
          assignedAt: latestAssignment?.assignedAt || null,
          assignedBy: latestAssignment?.assignedBy
            ? {
              id: latestAssignment.assignedBy.id,
              name: `${latestAssignment.assignedBy.firstName} ${latestAssignment.assignedBy.lastName || ''}`.trim(),
              role: latestAssignment.assignedBy.role?.name || 'User',
            }
            : null,
          assignedTo: latestAssignment?.assignedTo
            ? {
              id: latestAssignment.assignedTo.id,
              name: `${latestAssignment.assignedTo.firstName} ${latestAssignment.assignedTo.lastName || ''}`.trim(),
              role: latestAssignment.assignedTo.role?.name || 'User',
            }
            : null,
        };
      }
    }

    // 4. Fetch Activity Logs
    const collegeAppIds = lead.collegeApplications.map((c) => c.id);
    const tpcIds = lead.tpcs.map((t) => t.id);

    const activityLogs = await this.prisma.activityLog.findMany({
      where: {
        OR: [
          { entityType: 'LEAD', entityId: leadId },
          { entityType: 'Lead', entityId: leadId },
          ...(collegeAppIds.length > 0
            ? [
              { entityType: 'LEAD_COLLEGE', entityId: { in: collegeAppIds } },
              { entityType: 'LeadCollege', entityId: { in: collegeAppIds } },
            ]
            : []),
          ...(tpcIds.length > 0
            ? [
              { entityType: 'TPC', entityId: { in: tpcIds } },
              { entityType: 'Tpc', entityId: { in: tpcIds } },
            ]
            : []),
        ],
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 5. Fetch Status ordering configuration
    const allStatuses = await this.prisma.leadStatus.findMany({
      orderBy: { displayOrder: 'asc' },
    });

    const applicationStatus = allStatuses.find(
      (s) =>
        s.name.toUpperCase().includes('APPLICATION') ||
        s.name.toUpperCase().includes('APPLIED'),
    );
    const applicationThresholdOrder = applicationStatus ? applicationStatus.displayOrder : 3;

    // 6. Compute Lead Pipeline Status Stages
    const currentLeadStatusOrder = lead.status?.displayOrder || 1;
    const leadPipeline = allStatuses.map((st) => ({
      id: st.id,
      name: st.name,
      description: st.description,
      color: st.color,
      displayOrder: st.displayOrder,
      isCompleted: st.displayOrder < currentLeadStatusOrder,
      isCurrent: st.displayOrder === currentLeadStatusOrder,
      isUpcoming: st.displayOrder > currentLeadStatusOrder,
    }));

    // 7. Process College Journeys (Independent pipelines + Significance)
    const colleges = lead.collegeApplications.map((app) => {
      const isSignificant = app.status.displayOrder >= applicationThresholdOrder;
      const appStatusOrder = app.status.displayOrder;

      const pipeline = allStatuses.map((st) => ({
        id: st.id,
        name: st.name,
        description: st.description,
        color: st.color,
        displayOrder: st.displayOrder,
        isCompleted: st.displayOrder < appStatusOrder,
        isCurrent: st.displayOrder === appStatusOrder,
        isUpcoming: st.displayOrder > appStatusOrder,
      }));

      const pitchedByInfo = app.pitchedBy
        ? {
            id: app.pitchedBy.id,
            name: `${app.pitchedBy.firstName} ${app.pitchedBy.lastName || ''}`.trim(),
            role: app.pitchedBy.role?.name || 'User',
          }
        : null;

      // Application info
      const applicationDetails = {
        applicationId: app.applicationId || null,
        coursePitched: app.coursePitched || lead.courseInterested || 'N/A',
        specializationPitched: app.specializationPitched || lead.specializationInterested || 'N/A',
        feePitched: app.feePitched ? Number(app.feePitched) : null,
        createdAt: app.createdAt,
        pitchedBy: pitchedByInfo,
        processedBy: app.processedBy
          ? {
              id: app.processedBy.id,
              name: `${app.processedBy.firstName} ${app.processedBy.lastName || ''}`.trim(),
              role: app.processedBy.role?.name || 'User',
            }
          : null,
      };

      // Interviews
      const interviews = app.interviews.map((iv) => ({
        id: iv.id,
        scheduledAt: iv.scheduledAt,
        conductedAt: iv.conductedAt,
        status: iv.status,
        result: iv.result,
        feedback: iv.feedback,
        meetingLink: iv.meetingLink,
      }));

      // Selection Letters
      const selection = app.selectionLetters[0]
        ? {
            id: app.selectionLetters[0].id,
            letterUrl: app.selectionLetters[0].letterUrl,
            issuedAt: app.selectionLetters[0].issuedAt,
            admissionLastDate: app.selectionLetters[0].admissionLastDate,
            issuedBy: app.selectionLetters[0].issuedBy
              ? {
                  id: app.selectionLetters[0].issuedBy.id,
                  name: `${app.selectionLetters[0].issuedBy.firstName} ${app.selectionLetters[0].issuedBy.lastName || ''}`.trim(),
                  role: app.selectionLetters[0].issuedBy.role?.name || 'User',
                }
              : null,
          }
        : null;

      // Payments
      const payments = app.payments.map((p) => ({
        id: p.id,
        type: p.type,
        amount: Number(p.amount),
        transactionRef: p.transactionRef,
        paymentMode: p.paymentMode,
        paidAt: p.paidAt,
        remarks: p.remarks,
        refundStatus: p.refundStatus,
        processedBy: p.processedBy
          ? {
              id: p.processedBy.id,
              name: `${p.processedBy.firstName} ${p.processedBy.lastName || ''}`.trim(),
              role: p.processedBy.role?.name || 'User',
            }
          : null,
      }));

      // College-specific timeline history
      const collegeTimeline = app.history.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus?.name || 'NEW',
        toStatus: h.toStatus.name,
        remarks: h.remarks,
        changedAt: h.createdAt,
        changedBy: h.changedBy
          ? {
              id: h.changedBy.id,
              name: `${h.changedBy.firstName} ${h.changedBy.lastName || ''}`.trim(),
              role: h.changedBy.role?.name || 'User',
            }
          : null,
      }));

      return {
        id: app.id,
        collegeId: app.college.id,
        collegeName: app.college.name,
        collegeCity: app.college.city,
        collegeState: app.college.state,
        currentStatus: {
          id: app.status.id,
          name: app.status.name,
          color: app.status.color,
          displayOrder: app.status.displayOrder,
        },
        approvalStatus: app.approvalStatus,
        isSignificant,
        pipeline,
        pitchedBy: pitchedByInfo,
        applicationDetails,
        interviews,
        selection,
        payments,
        history: collegeTimeline,
        createdAt: app.createdAt,
      };
    });

    // 8. TPC Journey processing
    const tpcAssignments: any[] = [];
    for (const tpc of lead.tpcs) {
      for (const assign of tpc.assignments) {
        tpcAssignments.push({
          id: assign.id,
          tpcId: tpc.id,
          status: assign.status,
          assignedAt: assign.assignedAt,
          completedAt: assign.completedAt,
          assignedBy: assign.assignedBy
            ? {
              id: assign.assignedBy.id,
              name: `${assign.assignedBy.firstName} ${assign.assignedBy.lastName || ''}`.trim(),
              role: assign.assignedBy.role?.name || 'User',
            }
            : null,
          assignedTo: assign.assignedTo
            ? {
              id: assign.assignedTo.id,
              name: `${assign.assignedTo.firstName} ${assign.assignedTo.lastName || ''}`.trim(),
              role: assign.assignedTo.role?.name || 'User',
            }
            : null,
          completedBy: assign.completedBy
            ? {
              id: assign.completedBy.id,
              name: `${assign.completedBy.firstName} ${assign.completedBy.lastName || ''}`.trim(),
              role: assign.completedBy.role?.name || 'User',
            }
            : null,
        });
      }
    }

    // 9. Collect People Involved (deduplicated)
    const peopleMap = new Map<string, { id: string; name: string; email?: string; role: string; actions: Set<string> }>();

    const addPersonAction = (usr: any, action: string) => {
      if (!usr || !usr.id) return;
      const name = `${usr.firstName || ''} ${usr.lastName || ''}`.trim() || 'Unknown User';
      const role = usr.role?.name || 'User';
      if (!peopleMap.has(usr.id)) {
        peopleMap.set(usr.id, { id: usr.id, name, email: usr.email, role, actions: new Set([action]) });
      } else {
        peopleMap.get(usr.id)!.actions.add(action);
      }
    };

    if (dataOrigin?.uploadedBy?.id) {
      addPersonAction(dataOrigin.uploadedBy, 'Data Uploader');
    }
    if (dataOrigin?.assignedBy?.id) {
      addPersonAction(dataOrigin.assignedBy, 'Data Assigner');
    }
    if (dataOrigin?.assignedTo?.id) {
      addPersonAction(dataOrigin.assignedTo, 'Data Assignee');
    }
    if (lead.createdBy) {
      addPersonAction(lead.createdBy, 'Lead Creator');
    }

    for (const a of lead.assignments) {
      if (a.user) addPersonAction(a.user, 'Lead Assignee');
    }

    for (const ta of tpcAssignments) {
      if (ta.assignedBy) addPersonAction(ta.assignedBy, 'TPC Assigner');
      if (ta.assignedTo) addPersonAction(ta.assignedTo, 'TPC Counselor');
      if (ta.completedBy) addPersonAction(ta.completedBy, 'TPC Completer');
    }

    for (const c of lead.collegeApplications) {
      if (c.pitchedBy) addPersonAction(c.pitchedBy, `Pitched ${c.college.name}`);
      if (c.processedBy) addPersonAction(c.processedBy, `Approved Pitch for ${c.college.name}`);
      for (const sl of c.selectionLetters) {
        if (sl.issuedBy) addPersonAction(sl.issuedBy, `Issued Selection Letter (${c.college.name})`);
      }
      for (const pm of c.payments) {
        if (pm.processedBy) addPersonAction(pm.processedBy, `Processed Payment (${c.college.name})`);
      }
    }

    for (const it of lead.interactions) {
      if (it.createdBy) addPersonAction(it.createdBy, 'Interaction Creator');
    }

    const people = Array.from(peopleMap.values()).map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      role: p.role,
      actions: Array.from(p.actions),
    }));

    // 10. Construct Normalized Master Chronological Timeline
    const timelineEvents: any[] = [];

    // Data Acquired Event
    if (dataOrigin) {
      timelineEvents.push({
        id: `event-data-${dataOrigin.studentDataId}`,
        type: 'DATA_ACQUIRED',
        title: 'Data Acquired',
        description: `Imported via file "${dataOrigin.fileName}"`,
        timestamp: dataOrigin.uploadedAt,
        actor: dataOrigin.uploadedBy,
        metadata: { fileName: dataOrigin.fileName, fileUrl: dataOrigin.fileUrl },
      });

      if (dataOrigin.assignedAt) {
        timelineEvents.push({
          id: `event-data-assign-${dataOrigin.studentDataId}`,
          type: 'DATA_CLAIMED',
          title: 'Data Assigned / Claimed',
          description: `Data assigned to ${dataOrigin.assignedTo?.name || 'Advisor'}`,
          timestamp: dataOrigin.assignedAt,
          actor: dataOrigin.assignedBy || dataOrigin.assignedTo,
          metadata: { assignedTo: dataOrigin.assignedTo },
        });
      }
    }

    // Lead Created Event
    timelineEvents.push({
      id: `event-lead-created-${lead.id}`,
      type: 'LEAD_CREATED',
      title: 'Lead Created',
      description: `Lead created in system with status "${lead.status.name}"`,
      timestamp: lead.createdAt,
      actor: lead.createdBy
        ? {
          id: lead.createdBy.id,
          name: `${lead.createdBy.firstName} ${lead.createdBy.lastName || ''}`.trim(),
          role: lead.createdBy.role?.name || 'User',
        }
        : null,
      metadata: { source: lead.source },
    });

    // Lead Assignments Events
    for (const a of lead.assignments) {
      timelineEvents.push({
        id: `event-assignment-${a.id}`,
        type: 'LEAD_ASSIGNMENT',
        title: `Lead Assigned (${a.status})`,
        description: `Assigned to ${a.user.firstName} ${a.user.lastName || ''}`,
        timestamp: a.assignedAt,
        actor: {
          id: a.user.id,
          name: `${a.user.firstName} ${a.user.lastName || ''}`.trim(),
          role: a.user.role?.name || 'User',
        },
        metadata: { expiresAt: a.expiresAt, status: a.status },
      });
    }

    // TPC Events
    for (const ta of tpcAssignments) {
      timelineEvents.push({
        id: `event-tpc-assigned-${ta.id}`,
        type: 'TPC_ASSIGNED',
        title: 'TPC Assigned',
        description: `TPC task assigned to ${ta.assignedTo?.name || 'Counselor'}`,
        timestamp: ta.assignedAt,
        actor: ta.assignedBy,
        metadata: { assignedTo: ta.assignedTo, status: ta.status },
      });

      if (ta.completedAt) {
        timelineEvents.push({
          id: `event-tpc-completed-${ta.id}`,
          type: 'TPC_COMPLETED',
          title: 'TPC Completed',
          description: `TPC task completed by ${ta.completedBy?.name || 'Counselor'}`,
          timestamp: ta.completedAt,
          actor: ta.completedBy || ta.assignedTo,
          metadata: { status: ta.status },
        });
      }
    }

    // Interaction & Call Events
    for (const it of lead.interactions) {
      const isCall = it.title?.toLowerCase().includes('call') || it.description?.toLowerCase().includes('call');
      timelineEvents.push({
        id: `event-interaction-${it.id}`,
        type: isCall ? 'CALL' : 'INTERACTION',
        title: it.title || (isCall ? 'Phone Call' : 'Counselor Note'),
        description: it.description,
        timestamp: it.createdAt,
        actor: it.createdBy
          ? {
            id: it.createdBy.id,
            name: `${it.createdBy.firstName} ${it.createdBy.lastName || ''}`.trim(),
            role: it.createdBy.role?.name || 'User',
          }
          : null,
        metadata: { attachmentsCount: it.attachments.length },
      });
    }

    // College Journey Events
    for (const colApp of lead.collegeApplications) {
      const collegeName = colApp.college.name;

      timelineEvents.push({
        id: `event-college-pitch-${colApp.id}`,
        type: 'COLLEGE_PITCHED',
        title: `${collegeName} - Pitched`,
        description: `Pitched ${colApp.coursePitched || lead.courseInterested || 'Course'} to student`,
        timestamp: colApp.createdAt,
        actor: colApp.pitchedBy
          ? {
            id: colApp.pitchedBy.id,
            name: `${colApp.pitchedBy.firstName} ${colApp.pitchedBy.lastName || ''}`.trim(),
            role: colApp.pitchedBy.role?.name || 'User',
          }
          : null,
        metadata: { collegeId: colApp.collegeId, collegeName, coursePitched: colApp.coursePitched },
      });

      for (const h of colApp.history) {
        timelineEvents.push({
          id: `event-college-hist-${h.id}`,
          type: 'COLLEGE_STATUS_CHANGE',
          title: `${collegeName} - Status Changed to ${h.toStatus.name}`,
          description: h.remarks || `Status changed from ${h.fromStatus?.name || 'NEW'} to ${h.toStatus.name}`,
          timestamp: h.createdAt,
          actor: h.changedBy
            ? {
              id: h.changedBy.id,
              name: `${h.changedBy.firstName} ${h.changedBy.lastName || ''}`.trim(),
              role: h.changedBy.role?.name || 'User',
            }
            : null,
          metadata: { collegeId: colApp.collegeId, collegeName, fromStatus: h.fromStatus?.name, toStatus: h.toStatus.name },
        });
      }

      for (const iv of colApp.interviews) {
        timelineEvents.push({
          id: `event-interview-${iv.id}`,
          type: iv.conductedAt ? 'INTERVIEW_CONDUCTED' : 'INTERVIEW_SCHEDULED',
          title: `${collegeName} - Interview ${iv.conductedAt ? 'Conducted' : 'Scheduled'}`,
          description: `Status: ${iv.status}, Result: ${iv.result}${iv.feedback ? ` | Feedback: ${iv.feedback}` : ''}`,
          timestamp: iv.conductedAt || iv.scheduledAt,
          actor: null,
          metadata: { collegeId: colApp.collegeId, collegeName, result: iv.result, meetingLink: iv.meetingLink },
        });
      }

      for (const sl of colApp.selectionLetters) {
        timelineEvents.push({
          id: `event-selection-${sl.id}`,
          type: 'SELECTION_LETTER_ISSUED',
          title: `${collegeName} - Selection Letter Issued`,
          description: `Admission deadline: ${new Date(sl.admissionLastDate).toLocaleDateString()}`,
          timestamp: sl.issuedAt,
          actor: sl.issuedBy
            ? {
              id: sl.issuedBy.id,
              name: `${sl.issuedBy.firstName} ${sl.issuedBy.lastName || ''}`.trim(),
              role: sl.issuedBy.role?.name || 'User',
            }
            : null,
          metadata: { collegeId: colApp.collegeId, collegeName, letterUrl: sl.letterUrl },
        });
      }

      for (const pm of colApp.payments) {
        timelineEvents.push({
          id: `event-payment-${pm.id}`,
          type: 'PAYMENT_RECEIVED',
          title: `${collegeName} - Payment Received (${pm.type})`,
          description: `Amount: ₹${Number(pm.amount).toLocaleString('en-IN')}${pm.paymentMode ? ` via ${pm.paymentMode}` : ''}${pm.transactionRef ? ` (Ref: ${pm.transactionRef})` : ''}`,
          timestamp: pm.paidAt,
          actor: pm.processedBy
            ? {
              id: pm.processedBy.id,
              name: `${pm.processedBy.firstName} ${pm.processedBy.lastName || ''}`.trim(),
              role: pm.processedBy.role?.name || 'User',
            }
            : null,
          metadata: { collegeId: colApp.collegeId, collegeName, amount: Number(pm.amount), type: pm.type },
        });
      }
    }

    // Activity Log Events
    for (const al of activityLogs) {
      timelineEvents.push({
        id: `event-activity-${al.id}`,
        type: 'SYSTEM_ACTIVITY',
        title: `Activity: ${al.activity}`,
        description: al.description || `Action on ${al.entityType}`,
        timestamp: al.createdAt,
        actor: al.user
          ? {
            id: al.user.id,
            name: `${al.user.firstName} ${al.user.lastName || ''}`.trim(),
            role: al.user.role?.name || 'User',
          }
          : null,
        metadata: { activity: al.activity, entityType: al.entityType, entityId: al.entityId },
      });
    }

    // Sort Master Timeline descending by timestamp
    const masterTimeline = timelineEvents.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    // 11. Summary Metrics
    const activeAssignee = lead.assignments.find((a) => a.status === 'ACTIVE')?.user;
    const currentOwnerName = activeAssignee
      ? `${activeAssignee.firstName} ${activeAssignee.lastName || ''}`.trim()
      : lead.createdBy
        ? `${lead.createdBy.firstName} ${lead.createdBy.lastName || ''}`.trim()
        : 'Unassigned';

    const latestTpc = tpcAssignments[0];
    const totalPaidAmount = colleges.reduce((sum, c) => {
      return sum + c.payments.reduce((pSum, p) => pSum + p.amount, 0);
    }, 0);

    const summary = {
      acquiredAt: dataOrigin?.uploadedAt || lead.createdAt,
      currentOwner: currentOwnerName,
      tpcStatus: latestTpc ? latestTpc.status : 'NO_TPC',
      tpcAttemptsCount: tpcAssignments.length,
      callsInteractionsCount: lead.interactions.length,
      collegesCount: colleges.length,
      applicationsCount: colleges.filter((c) => c.isSignificant).length,
      interviewsCount: colleges.reduce((sum, c) => sum + c.interviews.length, 0),
      selectionsCount: colleges.reduce((sum, c) => sum + (c.selection ? 1 : 0), 0),
      paymentsCount: colleges.reduce((sum, c) => sum + c.payments.length, 0),
      totalPaidAmount,
      leadStatus: lead.status.name,
      leadStatusColor: lead.status.color,
    };

    return {
      lead: {
        id: lead.id,
        shortId: `LD-${lead.id.slice(0, 4).toUpperCase()}`,
        firstName: lead.firstName,
        lastName: lead.lastName,
        fullName: `${lead.firstName} ${lead.lastName || ''}`.trim(),
        phone: lead.phone,
        alternatePhone: lead.alternatePhone,
        email: lead.email,
        gender: lead.gender,
        dateOfBirth: lead.dateOfBirth,
        city: lead.city,
        state: lead.state,
        tenthPercentage: lead.tenthPercentage,
        twelfthPercentage: lead.twelfthPercentage,
        graduationPercentage: lead.graduationPercentage,
        graduationCourse: lead.graduationCourse,
        graduationSpecialization: lead.graduationSpecialization,
        courseInterested: lead.courseInterested,
        specializationInterested: lead.specializationInterested,
        passingYear: lead.passingYear,
        source: lead.source,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        status: {
          id: lead.status.id,
          name: lead.status.name,
          description: lead.status.description,
          color: lead.status.color,
          displayOrder: lead.status.displayOrder,
        },
        finalCollege: lead.finalCollege
          ? {
            id: lead.finalCollege.id,
            name: lead.finalCollege.name,
          }
          : null,
        createdBy: lead.createdBy
          ? {
            id: lead.createdBy.id,
            name: `${lead.createdBy.firstName} ${lead.createdBy.lastName || ''}`.trim(),
            email: lead.createdBy.email,
            role: lead.createdBy.role?.name || 'User',
          }
          : null,
      },
      summary,
      dataOrigin,
      leadPipeline,
      tpcJourney: {
        totalAssignments: tpcAssignments.length,
        latestStatus: latestTpc?.status || 'NONE',
        assignments: tpcAssignments,
      },
      colleges,
      people,
      masterTimeline,
    };
  }

  async createClaimRequest(leadId: string, userId: string) {
    const now = new Date();

    const lead = await this.prisma.lead.findUnique({
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

    const existingPending = await this.prisma.leadClaimRequest.findFirst({
      where: {
        leadId,
        status: 'PENDING',
      },
    });

    if (existingPending) {
      throw new ConflictException(
        'A pending claim request already exists for this lead.',
      );
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
          eligibility.reason || 'This lead is not eligible for claim request.',
        );
      }
    }

    const claimRequest = await this.prisma.leadClaimRequest.create({
      data: {
        leadId,
        requestedById: userId,
        status: 'PENDING',
        requestedAt: now,
      },
    });

    await this.prisma.activityLog.create({
      data: {
        userId,
        activity: 'LEAD',
        entityType: 'LEAD_CLAIM_REQUEST',
        entityId: claimRequest.id,
        description: `CLAIM_REQUESTED: Lead claim requested for lead ${leadId}`,
      },
    });

    return claimRequest;
  }

  async getClaimRequests(userId: string, query?: QueryClaimRequestDto) {
    const callingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (
      !callingUser ||
      (!callingUser.role?.name?.toUpperCase().includes('SUPER_ADMIN') &&
        callingUser.roleId !== 1)
    ) {
      throw new ForbiddenException(
        'Access denied: Only SUPER_ADMIN can view claim requests.',
      );
    }

    const where: any = {};
    if (query?.status) {
      where.status = query.status;
    }

    const requests = await this.prisma.leadClaimRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            createdById: true,
            createdBy: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
            assignments: {
              orderBy: { assignedAt: 'desc' },
              take: 1,
              include: {
                user: {
                  select: { id: true, firstName: true, lastName: true, email: true },
                },
              },
            },
          },
        },
        requestedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        processedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    return requests.map((req) => {
      const leadName = [req.lead.firstName, req.lead.lastName]
        .filter(Boolean)
        .join(' ');
      const currentOwnerUser =
        req.lead.assignments[0]?.user || req.lead.createdBy;
      const currentOwnerName = [
        currentOwnerUser?.firstName,
        currentOwnerUser?.lastName,
      ]
        .filter(Boolean)
        .join(' ');
      const requesterName = [
        req.requestedBy.firstName,
        req.requestedBy.lastName,
      ]
        .filter(Boolean)
        .join(' ');
      const processedByName = req.processedBy
        ? [req.processedBy.firstName, req.processedBy.lastName]
            .filter(Boolean)
            .join(' ')
        : null;

      return {
        requestId: req.id,
        leadId: req.leadId,
        leadName,
        phone: req.lead.phone,
        email: req.lead.email,
        currentOwner: {
          id: currentOwnerUser?.id,
          name: currentOwnerName,
          email: currentOwnerUser?.email,
        },
        requester: {
          id: req.requestedBy.id,
          name: requesterName,
          email: req.requestedBy.email,
        },
        status: req.status,
        requestedAt: req.requestedAt,
        processedBy: req.processedBy
          ? {
              id: req.processedBy.id,
              name: processedByName,
              email: req.processedBy.email,
            }
          : null,
        processedAt: req.processedAt,
        remarks: req.remarks,
      };
    });
  }

  async processClaimRequest(
    requestId: string,
    superAdminId: string,
    dto: ProcessClaimRequestDto,
  ) {
    const callingUser = await this.prisma.user.findUnique({
      where: { id: superAdminId },
      include: { role: true },
    });

    if (
      !callingUser ||
      (!callingUser.role?.name?.toUpperCase().includes('SUPER_ADMIN') &&
        callingUser.roleId !== 1)
    ) {
      throw new ForbiddenException(
        'Access denied: Only SUPER_ADMIN can process claim requests.',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const lockedRequestRaw = await tx.$queryRaw<any[]>`
          SELECT id, status, "leadId", "requestedById" FROM "LeadClaimRequest" WHERE id = ${requestId}::uuid FOR UPDATE
        `;

        if (!lockedRequestRaw || lockedRequestRaw.length === 0) {
          throw new NotFoundException('Claim request not found');
        }
        const lockedRequest = lockedRequestRaw[0];

        if (lockedRequest.status !== 'PENDING') {
          throw new ConflictException(
            'Claim request is no longer pending and has already been processed.',
          );
        }

        const leadId = lockedRequest.leadId;
        await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${leadId}::uuid FOR UPDATE`;

        const lead = await tx.lead.findUnique({
          where: { id: leadId },
          include: {
            status: true,
            assignments: { orderBy: { assignedAt: 'desc' } },
          },
        });

        if (!lead) {
          throw new NotFoundException('Lead not found');
        }

        const now = new Date();

        if (dto.status === 'REJECTED') {
          const updatedRequest = await tx.leadClaimRequest.update({
            where: { id: requestId },
            data: {
              status: 'REJECTED',
              processedById: superAdminId,
              processedAt: now,
              remarks: dto.remarks || null,
            },
          });

          await tx.activityLog.create({
            data: {
              userId: superAdminId,
              activity: 'LEAD',
              entityType: 'LEAD_CLAIM_REQUEST',
              entityId: requestId,
              description: `CLAIM_REJECTED: Claim request rejected by Super Admin. Requester: ${lockedRequest.requestedById}. Remarks: ${dto.remarks || 'None'}`,
            },
          });

          const leadName = [lead.firstName, lead.lastName]
            .filter(Boolean)
            .join(' ');
          await this.notificationsService.createNotification(
            {
              title: 'Lead Claim Rejected',
              message: `Your request to claim lead ${leadName} has been rejected.`,
              type: 'LEAD',
              recipientUserIds: [lockedRequest.requestedById],
            },
            tx,
          );

          return {
            message: 'Claim request rejected successfully',
            claimRequest: updatedRequest,
          };
        }

        // IF APPROVED:
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

        const requester = await tx.user.findUnique({
          where: { id: lockedRequest.requestedById },
          select: { id: true, status: true },
        });

        if (!requester || requester.status !== 'ACTIVE') {
          throw new NotFoundException('Requester user not found or is inactive.');
        }

        const previousOwnerId = lead.assignments[0]?.userId || lead.createdById;

        await tx.leadAssignment.updateMany({
          where: {
            leadId,
            status: 'ACTIVE',
          },
          data: { status: 'EXPIRED' },
        });

        const expiresAt = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

        const newAssignment = await tx.leadAssignment.create({
          data: {
            leadId,
            userId: lockedRequest.requestedById,
            assignedAt: now,
            expiresAt,
            status: 'ACTIVE',
          },
        });

        const ownershipHistory = await tx.leadOwnershipHistory.create({
          data: {
            leadId,
            previousOwnerId: previousOwnerId || null,
            newOwnerId: lockedRequest.requestedById,
            changedById: superAdminId,
            reason: 'CLAIM_APPROVED',
          },
        });

        const updatedRequest = await tx.leadClaimRequest.update({
          where: { id: requestId },
          data: {
            status: 'APPROVED',
            processedById: superAdminId,
            processedAt: now,
            remarks: dto.remarks || null,
          },
        });

        const leadName = [lead.firstName, lead.lastName]
          .filter(Boolean)
          .join(' ');
        await this.notificationsService.createNotification(
          {
            title: 'Lead Claim Approved',
            message: `Your request to claim lead ${leadName} has been approved.`,
            type: 'LEAD',
            recipientUserIds: [lockedRequest.requestedById],
          },
          tx,
        );

        await tx.activityLog.create({
          data: {
            userId: superAdminId,
            activity: 'LEAD',
            entityType: 'LEAD_CLAIM_REQUEST',
            entityId: requestId,
            description: `CLAIM_APPROVED: Lead ${leadId} ownership transferred from ${previousOwnerId} to ${lockedRequest.requestedById} by Super Admin ${superAdminId}`,
          },
        });

        return {
          message: 'Claim request approved successfully',
          claimRequest: updatedRequest,
          assignment: newAssignment,
          ownershipHistory,
        };
      },
      { timeout: 30000 },
    );
  }
}


