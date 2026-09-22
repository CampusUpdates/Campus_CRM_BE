import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { ActivityType } from '@prisma/client';
import { TeamLeadAuthorizationService } from './team-lead-authorization.service';
import { processUserTeamTransfer } from 'src/users/utils/team-transfer.util';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLogService: ActivityLogService,
    private readonly teamLeadAuthService: TeamLeadAuthorizationService,
  ) {}

  // Find single team header details with authorization check
  async findOneForManager(teamIdStr: string, user: { sub: string }) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) {
      throw new BadRequestException('Invalid team ID provided.');
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { role: { select: { name: true } } },
    });

    const isManager = team.managerId === user.sub;
    const isSuperOrHr = ['SUPER_ADMIN', 'HR', 'SUPERADMIN', 'ADMIN'].includes(
      (userRecord?.role?.name || '').toUpperCase(),
    );
    const isTeamLead = await this.teamLeadAuthService.canTeamLeadAccessTeam(user.sub, teamId);

    if (!isManager && !isSuperOrHr && !isTeamLead) {
      throw new ForbiddenException('You do not have access to this team.');
    }

    const { _count, ...rest } = team;
    return {
      ...rest,
      memberCount: _count.users,
    };
  }

  // Get active members belonging to a specific team with authorization check
  async getTeamMembersForManager(teamIdStr: string, user: { sub: string }) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) {
      throw new BadRequestException('Invalid team ID provided.');
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { managerId: true },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { teamId: true, role: { select: { name: true } } },
    });

    const isSuperOrHr = ['SUPER_ADMIN', 'HR', 'SUPERADMIN', 'ADMIN'].includes(
      (userRecord?.role?.name || '').toUpperCase(),
    );
    const isManager = team.managerId === user.sub;
    const isTeamLead = await this.teamLeadAuthService.canTeamLeadAccessTeam(user.sub, teamId);

    if (!isManager && !isSuperOrHr && !isTeamLead) {
      throw new ForbiddenException('You do not have access to this team.');
    }

    // Manager / Team Lead / HR / Super Admin view: return all team members
    return this.prisma.user.findMany({
      where: {
        OR: [
          { teamId },
          ...(team.managerId ? [{ managerId: team.managerId }] : []),
        ],
        status: 'ACTIVE',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        firstName: 'asc',
      },
    });
  }

  // Find all teams with manager info and member count (scoped for Manager & Team Lead)
  async findAll(user?: { sub: string }) {
    let whereClause: any = {};
    if (user?.sub) {
      const userRecord = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { teamId: true, role: { select: { name: true } } },
      });
      const roleName = (userRecord?.role?.name || '').toUpperCase();
      const isSuperOrHr = ['SUPER_ADMIN', 'HR', 'SUPERADMIN', 'ADMIN'].includes(roleName);

      if (!isSuperOrHr) {
        const isTL = await this.teamLeadAuthService.isTeamLead(user.sub);
        const assignedTeamIds = isTL
          ? await this.teamLeadAuthService.getTeamLeadAssignedTeamIds(user.sub)
          : [];

        const orConditions: any[] = [{ managerId: user.sub }];
        if (assignedTeamIds.length > 0) {
          orConditions.push({ id: { in: assignedTeamIds } });
        }

        whereClause = { OR: orConditions };
      }
    }

    const teams = await this.prisma.team.findMany({
      where: whereClause,
      orderBy: {
        name: 'asc',
      },
      include: {
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    return teams.map((team) => {
      const { _count, ...rest } = team;
      return {
        ...rest,
        memberCount: _count.users,
      };
    });
  }

  // Get users eligible to manage teams
  async getEligibleManagers() {
    const eligibleManagers = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          {
            role: {
              name: {
                in: ['SUPER_ADMIN', 'HR', 'Manager'],
              },
            },
          },
          {
            role: {
              permissions: {
                some: {
                  permission: {
                    name: 'TEAM_MANAGE',
                  },
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
      orderBy: {
        firstName: 'asc',
      },
    });

    return eligibleManagers;
  }

  // Get users eligible to be team members (all active users with role, status, and team info)
  async getEligibleMembers() {
    const eligibleMembers = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        role: {
          select: {
            id: true,
            name: true,
          },
        },
        teamId: true,
        team: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        firstName: 'asc',
      },
    });

    return eligibleMembers;
  }

  // Create team with manager and members in ONE atomic Prisma $transaction (HR/Super Admin only)
  async create(createTeamDto: CreateTeamDto, user?: { sub: string }) {
    const {
      name,
      description,
      managerId,
      memberIds = [],
      teamLeadIds = [],
      teamLeadAdvisorAssignments = [],
    } = createTeamDto;

    if (user?.sub) {
      const creatorRecord = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { role: { select: { name: true } } },
      });
      const roleName = creatorRecord?.role?.name || '';
      if (!['HR', 'SUPER_ADMIN'].includes(roleName)) {
        throw new ForbiddenException(
          'Only HR personnel have the right to create a team.',
        );
      }
    }

    return this.prisma.$transaction(
      async (tx) => {
      const existingTeam = await tx.team.findUnique({
        where: { name },
      });

      if (existingTeam) {
        throw new ConflictException('Team name already exists.');
      }

      const manager = await tx.user.findUnique({
        where: { id: managerId },
        select: {
          id: true,
          status: true,
          role: {
            select: {
              name: true,
              permissions: {
                select: {
                  permission: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!manager) {
        throw new NotFoundException('Selected manager does not exist.');
      }

      if (manager.status !== 'ACTIVE') {
        throw new BadRequestException('Selected manager is inactive.');
      }

      const hasTeamManagePerm =
        ['SUPER_ADMIN', 'HR', 'Manager'].includes(manager.role.name) ||
        manager.role.permissions.some(
          (p) => p.permission.name === 'TEAM_MANAGE',
        );

      if (!hasTeamManagePerm) {
        throw new BadRequestException(
          'Selected user is not eligible to manage teams.',
        );
      }

      if (memberIds.length > 0) {
        const members = await tx.user.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, status: true, teamId: true },
        });

        if (members.length !== memberIds.length) {
          throw new BadRequestException(
            'One or more selected users do not exist.',
          );
        }

        const inactiveMember = members.find((m) => m.status !== 'ACTIVE');
        if (inactiveMember) {
          throw new BadRequestException(
            'One or more selected users are inactive.',
          );
        }

        const alreadyAssignedMember = members.find((m) => m.teamId !== null);
        if (alreadyAssignedMember) {
          throw new BadRequestException(
            'One or more selected users already belong to another team.',
          );
        }
      }

      if (teamLeadIds.length > 0) {
        const teamLeads = await tx.user.findMany({
          where: { id: { in: teamLeadIds } },
          select: {
            id: true,
            status: true,
            role: { select: { name: true } },
          },
        });

        if (teamLeads.length !== teamLeadIds.length) {
          throw new BadRequestException(
            'One or more selected Team Leads do not exist.',
          );
        }

        const inactiveTL = teamLeads.find((tl) => tl.status !== 'ACTIVE');
        if (inactiveTL) {
          throw new BadRequestException(
            'One or more selected Team Leads are inactive.',
          );
        }

        const invalidRoleTL = teamLeads.find((tl) => {
          const roleClean = (tl.role?.name || '').toUpperCase().replace(/\s+/g, '_');
          return !['TEAM_LEAD', 'TEAMLEAD'].includes(roleClean);
        });
        if (invalidRoleTL) {
          throw new BadRequestException(
            'One or more selected users do not have the Team Lead role.',
          );
        }
      }

      const createdTeam = await tx.team.create({
        data: {
          name,
          description,
          managerId,
        },
      });

      if (memberIds.length > 0) {
        for (const memberId of memberIds) {
          await processUserTeamTransfer(tx, memberId, createdTeam.id);
        }
      }

      if (teamLeadIds.length > 0) {
        for (const tlId of teamLeadIds) {
          await tx.teamLead.upsert({
            where: { teamId_userId: { teamId: createdTeam.id, userId: tlId } },
            create: { teamId: createdTeam.id, userId: tlId },
            update: {},
          });
        }
      }

      if (teamLeadAdvisorAssignments.length > 0) {
        for (const assign of teamLeadAdvisorAssignments) {
          if (!teamLeadIds.includes(assign.teamLeadId)) {
            throw new BadRequestException(
              'Assigned Team Lead must belong to the team.',
            );
          }

          if (assign.advisorIds.length > 0) {
            const advisors = await tx.user.findMany({
              where: { id: { in: assign.advisorIds } },
              select: {
                id: true,
                status: true,
                teamId: true,
                role: { select: { name: true } },
              },
            });

            if (advisors.length !== assign.advisorIds.length) {
              throw new BadRequestException(
                'One or more selected Program Advisors do not exist.',
              );
            }

            for (const adv of advisors) {
              if (adv.status !== 'ACTIVE') {
                throw new BadRequestException(
                  'One or more selected Program Advisors are inactive.',
                );
              }
              const roleClean = (adv.role?.name || '').toUpperCase().replace(/\s+/g, '_');
              if (
                !['PROGRAM_ADVISOR', 'PROGRAMADVISOR', 'PA', 'ADVISOR'].includes(
                  roleClean,
                )
              ) {
                throw new BadRequestException(
                  'One or more selected users do not have the Program Advisor role.',
                );
              }
              if (!memberIds.includes(adv.id) && adv.teamId !== createdTeam.id) {
                throw new BadRequestException(
                  'Program Advisor does not belong to the same team.',
                );
              }

              await tx.teamLeadAdvisor.upsert({
                where: {
                  teamLeadId_advisorId: {
                    teamLeadId: assign.teamLeadId,
                    advisorId: adv.id,
                  },
                },
                create: {
                  teamLeadId: assign.teamLeadId,
                  advisorId: adv.id,
                },
                update: {},
              });
            }
          }
        }
      }

      const teamResult = await tx.team.findUnique({
        where: { id: createdTeam.id },
        include: {
          manager: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          users: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: { select: { users: true } },
        },
      });

      if (!teamResult) {
        throw new NotFoundException('Created team not found.');
      }

      const { _count, ...rest } = teamResult;
      return {
        ...rest,
        memberCount: _count.users,
      };
    }, { maxWait: 10000, timeout: 60000 });
  }

  // Update Team (atomic transaction)
  async update(
    teamIdStr: string,
    updateTeamDto: UpdateTeamDto,
    user?: { sub: string },
  ) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) {
      throw new BadRequestException('Invalid team ID provided.');
    }

    if (user?.sub) {
      const creatorRecord = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { role: { select: { name: true } } },
      });
      const roleName = creatorRecord?.role?.name || '';
      if (!['HR', 'SUPER_ADMIN'].includes(roleName)) {
        throw new ForbiddenException(
          'Only HR personnel have the right to edit a team.',
        );
      }
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { users: { select: { id: true } } },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    if (updateTeamDto.name && updateTeamDto.name.trim() !== team.name) {
      const existingName = await this.prisma.team.findUnique({
        where: { name: updateTeamDto.name.trim() },
      });
      if (existingName && existingName.id !== teamId) {
        throw new ConflictException('Team name already exists.');
      }
    }

    if (updateTeamDto.managerId && updateTeamDto.managerId !== team.managerId) {
      const manager = await this.prisma.user.findUnique({
        where: { id: updateTeamDto.managerId },
        select: {
          id: true,
          status: true,
          role: {
            select: {
              name: true,
              permissions: {
                select: {
                  permission: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!manager) {
        throw new NotFoundException('Selected manager does not exist.');
      }

      if (manager.status !== 'ACTIVE') {
        throw new BadRequestException('Selected manager is inactive.');
      }

      const hasTeamManagePerm =
        ['SUPER_ADMIN', 'HR', 'Manager'].includes(manager.role.name) ||
        manager.role.permissions.some(
          (p) => p.permission.name === 'TEAM_MANAGE',
        );

      if (!hasTeamManagePerm) {
        throw new BadRequestException(
          'Selected user is not eligible to manage teams.',
        );
      }
    }

    const currentMemberIds = team.users.map((u) => u.id);
    let addedMemberIds: string[] = [];
    let removedMemberIds: string[] = [];

    if (updateTeamDto.memberIds !== undefined) {
      const requestedMemberIds = updateTeamDto.memberIds;
      addedMemberIds = requestedMemberIds.filter(
        (id) => !currentMemberIds.includes(id),
      );
      removedMemberIds = currentMemberIds.filter(
        (id) => !requestedMemberIds.includes(id),
      );

      if (addedMemberIds.length > 0) {
        const addedUsers = await this.prisma.user.findMany({
          where: { id: { in: addedMemberIds } },
          select: { id: true, status: true },
        });

        if (addedUsers.length !== addedMemberIds.length) {
          throw new BadRequestException(
            'One or more selected users do not exist.',
          );
        }

        const inactiveUser = addedUsers.find((u) => u.status !== 'ACTIVE');
        if (inactiveUser) {
          throw new BadRequestException(
            'One or more selected users are inactive.',
          );
        }
      }
    }

    return this.prisma.$transaction(
      async (tx) => {
      const updateData: any = {};
      if (updateTeamDto.name !== undefined) {
        updateData.name = updateTeamDto.name.trim();
      }
      if (updateTeamDto.description !== undefined) {
        updateData.description = updateTeamDto.description?.trim() || null;
      }
      if (updateTeamDto.managerId !== undefined) {
        updateData.managerId = updateTeamDto.managerId;
      }

      if (Object.keys(updateData).length > 0) {
        await tx.team.update({
          where: { id: teamId },
          data: updateData,
        });
      }

      if (
        updateTeamDto.memberIds !== undefined &&
        removedMemberIds.length > 0
      ) {
        for (const removedId of removedMemberIds) {
          await processUserTeamTransfer(tx, removedId, null);
        }
      }

      if (updateTeamDto.memberIds !== undefined && addedMemberIds.length > 0) {
        for (const addedId of addedMemberIds) {
          await processUserTeamTransfer(tx, addedId, teamId);
        }
      }

      if (updateTeamDto.teamLeadIds !== undefined) {
        const currentTLs = await tx.teamLead.findMany({
          where: { teamId },
          select: { userId: true },
        });
        const currentTLIds = currentTLs.map((tl) => tl.userId);
        const requestedTLIds = updateTeamDto.teamLeadIds;

        const addedTLIds = requestedTLIds.filter(
          (id) => !currentTLIds.includes(id),
        );
        const removedTLIds = currentTLIds.filter(
          (id) => !requestedTLIds.includes(id),
        );

        for (const removedTlId of removedTLIds) {
          await tx.teamLead.deleteMany({
            where: { teamId, userId: removedTlId },
          });

          const teamAdvisors = await tx.user.findMany({
            where: { teamId },
            select: { id: true },
          });
          const advIds = teamAdvisors.map((a) => a.id);
          if (advIds.length > 0) {
            await tx.teamLeadAdvisor.deleteMany({
              where: {
                teamLeadId: removedTlId,
                advisorId: { in: advIds },
              },
            });
          }
        }

        if (addedTLIds.length > 0) {
          const addedTLs = await tx.user.findMany({
            where: { id: { in: addedTLIds } },
            select: {
              id: true,
              status: true,
              role: { select: { name: true } },
            },
          });
          if (addedTLs.length !== addedTLIds.length) {
            throw new BadRequestException(
              'One or more selected Team Leads do not exist.',
            );
          }
          for (const tl of addedTLs) {
            if (tl.status !== 'ACTIVE') {
              throw new BadRequestException(
                'One or more selected Team Leads are inactive.',
              );
            }
            const roleClean = (tl.role?.name || '').toUpperCase().replace(/\s+/g, '_');
            if (!['TEAM_LEAD', 'TEAMLEAD'].includes(roleClean)) {
              throw new BadRequestException(
                'One or more selected users do not have the Team Lead role.',
              );
            }
            await tx.teamLead.upsert({
              where: { teamId_userId: { teamId, userId: tl.id } },
              create: { teamId, userId: tl.id },
              update: {},
            });
          }
        }
      }

      if (updateTeamDto.teamLeadAdvisorAssignments !== undefined) {
        for (const assign of updateTeamDto.teamLeadAdvisorAssignments) {
          const isTLAssigned = await tx.teamLead.findUnique({
            where: { teamId_userId: { teamId, userId: assign.teamLeadId } },
          });
          if (!isTLAssigned) {
            throw new BadRequestException(
              'Assigned Team Lead is not assigned to this team.',
            );
          }

          if (assign.advisorIds.length > 0) {
            const advisors = await tx.user.findMany({
              where: { id: { in: assign.advisorIds } },
              select: {
                id: true,
                status: true,
                teamId: true,
                role: { select: { name: true } },
              },
            });
            if (advisors.length !== assign.advisorIds.length) {
              throw new BadRequestException(
                'One or more selected Program Advisors do not exist.',
              );
            }
            for (const adv of advisors) {
              if (adv.status !== 'ACTIVE') {
                throw new BadRequestException(
                  'One or more selected Program Advisors are inactive.',
                );
              }
              const roleClean = (adv.role?.name || '').toUpperCase().replace(/\s+/g, '_');
              if (
                !['PROGRAM_ADVISOR', 'PROGRAMADVISOR', 'PA', 'ADVISOR'].includes(
                  roleClean,
                )
              ) {
                throw new BadRequestException(
                  'One or more selected users do not have the Program Advisor role.',
                );
              }
              if (adv.teamId !== teamId) {
                throw new BadRequestException(
                  'Program Advisor does not belong to this team.',
                );
              }
              await tx.teamLeadAdvisor.upsert({
                where: {
                  teamLeadId_advisorId: {
                    teamLeadId: assign.teamLeadId,
                    advisorId: adv.id,
                  },
                },
                create: { teamLeadId: assign.teamLeadId, advisorId: adv.id },
                update: {},
              });
            }
          }
        }
      }

      if (user?.sub) {
        let desc = `Updated team ${updateTeamDto.name || team.name}.`;
        if (updateTeamDto.memberIds !== undefined) {
          desc += ` Added ${addedMemberIds.length} member(s), removed ${removedMemberIds.length} member(s).`;
        }
        await tx.activityLog.create({
          data: {
            userId: user.sub,
            activity: ActivityType.TEAM,
            entityType: 'TEAM',
            entityId: String(teamId),
            description: desc,
          },
        });
      }

      const updatedTeam = await tx.team.findUnique({
        where: { id: teamId },
        include: {
          manager: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          users: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: { select: { users: true } },
        },
      });

      if (!updatedTeam) {
        throw new NotFoundException('Updated team not found.');
      }

      const { _count, ...rest } = updatedTeam;
      return {
        ...rest,
        memberCount: _count.users,
      };
    }, { maxWait: 10000, timeout: 60000 });
  }

  // Safe Permanent Team Deletion
  async remove(teamIdStr: string, user?: { sub: string }) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) {
      throw new BadRequestException('Invalid team ID provided.');
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        _count: { select: { users: true } },
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    const affectedCount = team._count.users;

    await this.prisma.$transaction(
      async (tx) => {
      const teamMembers = await tx.user.findMany({
        where: { teamId },
        select: { id: true },
      });
      for (const member of teamMembers) {
        await processUserTeamTransfer(tx, member.id, null);
      }

      if (user?.sub) {
        await tx.activityLog.create({
          data: {
            userId: user.sub,
            activity: ActivityType.TEAM,
            entityType: 'TEAM',
            entityId: String(teamId),
            description: `Permanently deleted team ${team.name}. ${affectedCount} employee${affectedCount === 1 ? '' : 's'
              } moved to Unassigned.`,
          },
        });
      }

      await tx.team.delete({
        where: { id: teamId },
      });
    }, { maxWait: 10000, timeout: 60000 });

    return {
      message: `Permanently deleted team ${team.name}. ${affectedCount} employee${affectedCount === 1 ? '' : 's'
        } moved to Unassigned.`,
    };
  }

  // Helper to assert caller has Manager/HR/SuperAdmin authority for a Team
  private async assertTeamManagerOrAdmin(teamId: number, callerId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { managerId: true },
    });
    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    const userRecord = await this.prisma.user.findUnique({
      where: { id: callerId },
      select: { role: { select: { name: true } } },
    });

    const roleName = (userRecord?.role?.name || '').toUpperCase();
    const isSuperOrHr = ['SUPER_ADMIN', 'HR', 'SUPERADMIN', 'ADMIN'].includes(roleName);
    const isManager = team.managerId === callerId;

    if (!isManager && !isSuperOrHr) {
      throw new ForbiddenException(
        'Only Team Manager, HR personnel, or Super Admin can manage Team Leads.',
      );
    }
    return team;
  }

  // Assign Team Lead to Team
  async assignTeamLead(teamIdStr: string, targetUserId: string, caller: { sub: string }) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) throw new BadRequestException('Invalid team ID.');

    await this.assertTeamManagerOrAdmin(teamId, caller.sub);

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true, role: { select: { name: true } } },
    });

    if (!targetUser) throw new NotFoundException('Target user not found.');
    if (targetUser.status !== 'ACTIVE') throw new BadRequestException('Target user is inactive.');

    const roleName = (targetUser.role?.name || '').toUpperCase().replace(/\s+/g, '_');
    if (!['TEAM_LEAD', 'TEAMLEAD'].includes(roleName)) {
      throw new BadRequestException('Target user does not have the Team Lead role.');
    }

    return this.prisma.teamLead.upsert({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      create: { teamId, userId: targetUserId },
      update: {},
    });
  }

  // Remove Team Lead from Team
  async removeTeamLead(teamIdStr: string, targetUserId: string, caller: { sub: string }) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) throw new BadRequestException('Invalid team ID.');

    await this.assertTeamManagerOrAdmin(teamId, caller.sub);

    const record = await this.prisma.teamLead.findUnique({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });

    if (!record) {
      throw new NotFoundException('Team Lead assignment not found for this team.');
    }

    // Clean up TeamLeadAdvisor records for this team lead and advisors in this team
    const teamAdvisors = await this.prisma.user.findMany({
      where: { teamId },
      select: { id: true },
    });
    const advisorIds = teamAdvisors.map((a) => a.id);

    if (advisorIds.length > 0) {
      await this.prisma.teamLeadAdvisor.deleteMany({
        where: {
          teamLeadId: targetUserId,
          advisorId: { in: advisorIds },
        },
      });
    }

    return this.prisma.teamLead.delete({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
  }

  // Get Team Leads of a Team
  async getTeamLeads(teamIdStr: string, caller: { sub: string }) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) throw new BadRequestException('Invalid team ID.');

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { managerId: true },
    });
    if (!team) throw new NotFoundException('Team not found.');

    const callerRecord = await this.prisma.user.findUnique({
      where: { id: caller.sub },
      select: { role: { select: { name: true } } },
    });
    const roleName = (callerRecord?.role?.name || '').toUpperCase();
    const isSuperOrHr = ['SUPER_ADMIN', 'HR', 'SUPERADMIN', 'ADMIN'].includes(roleName);
    const isManager = team.managerId === caller.sub;
    const isTeamLead = await this.teamLeadAuthService.canTeamLeadAccessTeam(caller.sub, teamId);

    if (!isManager && !isSuperOrHr && !isTeamLead) {
      throw new ForbiddenException('Access denied to view Team Leads for this team.');
    }

    const teamLeads = await this.prisma.teamLead.findMany({
      where: { teamId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            status: true,
            role: { select: { id: true, name: true } },
          },
        },
      },
    });

    return teamLeads.map((tl) => tl.user);
  }

  // Assign Program Advisor to Team Lead
  async assignAdvisorToTeamLead(
    teamIdStr: string,
    teamLeadId: string,
    advisorId: string,
    caller: { sub: string },
  ) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) throw new BadRequestException('Invalid team ID.');

    await this.assertTeamManagerOrAdmin(teamId, caller.sub);

    const isTLAssigned = await this.teamLeadAuthService.canTeamLeadAccessTeam(teamLeadId, teamId);
    if (!isTLAssigned) {
      throw new BadRequestException('Team Lead is not assigned to this team.');
    }

    const advisor = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: {
        id: true,
        status: true,
        teamId: true,
        role: { select: { name: true } },
      },
    });

    if (!advisor) throw new NotFoundException('Target advisor not found.');
    if (advisor.status !== 'ACTIVE') throw new BadRequestException('Target advisor is inactive.');

    const advisorRole = (advisor.role?.name || '').toUpperCase().replace(/\s+/g, '_');
    if (!['PROGRAM_ADVISOR', 'PROGRAMADVISOR', 'PA', 'ADVISOR'].includes(advisorRole)) {
      throw new BadRequestException('Target user is not a Program Advisor.');
    }

    if (advisor.teamId !== teamId) {
      throw new BadRequestException('Program Advisor does not belong to this team.');
    }

    return this.prisma.teamLeadAdvisor.upsert({
      where: { teamLeadId_advisorId: { teamLeadId, advisorId } },
      create: { teamLeadId, advisorId },
      update: {},
    });
  }

  // Remove Program Advisor from Team Lead
  async removeAdvisorFromTeamLead(
    teamIdStr: string,
    teamLeadId: string,
    advisorId: string,
    caller: { sub: string },
  ) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) throw new BadRequestException('Invalid team ID.');

    await this.assertTeamManagerOrAdmin(teamId, caller.sub);

    const isTLAssigned = await this.teamLeadAuthService.canTeamLeadAccessTeam(teamLeadId, teamId);
    if (!isTLAssigned) {
      throw new BadRequestException('Team Lead is not assigned to this team.');
    }

    const advisor = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: { teamId: true },
    });
    if (!advisor || advisor.teamId !== teamId) {
      throw new BadRequestException('Advisor does not belong to requested team.');
    }

    const rel = await this.prisma.teamLeadAdvisor.findUnique({
      where: { teamLeadId_advisorId: { teamLeadId, advisorId } },
    });

    if (!rel) {
      throw new NotFoundException('Team Lead Advisor relationship does not exist.');
    }

    return this.prisma.teamLeadAdvisor.delete({
      where: { teamLeadId_advisorId: { teamLeadId, advisorId } },
    });
  }

  // Get Program Advisors supervised by a Team Lead
  async getTeamLeadAdvisors(
    teamIdStr: string,
    targetTeamLeadId: string,
    caller: { sub: string },
  ) {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) throw new BadRequestException('Invalid team ID.');

    const isTLAssigned = await this.teamLeadAuthService.canTeamLeadAccessTeam(targetTeamLeadId, teamId);
    if (!isTLAssigned) {
      throw new NotFoundException('Target Team Lead is not assigned to this team.');
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { managerId: true },
    });
    if (!team) throw new NotFoundException('Team not found.');

    const callerRecord = await this.prisma.user.findUnique({
      where: { id: caller.sub },
      select: { role: { select: { name: true } } },
    });
    const roleName = (callerRecord?.role?.name || '').toUpperCase();
    const isSuperOrHr = ['SUPER_ADMIN', 'HR', 'SUPERADMIN', 'ADMIN'].includes(roleName);
    const isManager = team.managerId === caller.sub;
    const isSelf = caller.sub === targetTeamLeadId;

    if (!isManager && !isSuperOrHr && !isSelf) {
      throw new ForbiddenException(
        'You are not authorized to view another Team Lead\'s supervised advisors.',
      );
    }

    const records = await this.prisma.teamLeadAdvisor.findMany({
      where: {
        teamLeadId: targetTeamLeadId,
        advisor: {
          teamId, // Query-level filter!
          status: 'ACTIVE',
        },
      },
      include: {
        advisor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            teamId: true,
            status: true,
            role: { select: { id: true, name: true } },
          },
        },
      },
    });

    return records.map((r) => r.advisor);
  }
}
