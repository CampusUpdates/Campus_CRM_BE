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

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLogService: ActivityLogService,
  ) {}

  // Find single team header details with authorization check for manager
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

    // Authorization check: manager must manage team OR user must be SUPER_ADMIN / HR
    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { role: { select: { name: true } } },
    });

    const isManager = team.managerId === user.sub;
    const isSuperOrHr = ['SUPER_ADMIN', 'HR'].includes(
      userRecord?.role?.name || '',
    );

    if (!isManager && !isSuperOrHr) {
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

    const isManager =
      team.managerId === user.sub || userRecord?.teamId === teamId;
    const isSuperOrHr = ['SUPER_ADMIN', 'HR', 'SUPERADMIN', 'ADMIN'].includes(
      (userRecord?.role?.name || '').toUpperCase(),
    );

    if (!isManager && !isSuperOrHr) {
      throw new ForbiddenException('You do not have access to this team.');
    }

    const members = await this.prisma.user.findMany({
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

    return members;
  }

  // Find all teams with manager info and member count (scoped for Manager)
  async findAll(user?: { sub: string }) {
    let whereClause: any = {};
    if (user?.sub) {
      const userRecord = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { teamId: true, role: { select: { name: true } } },
      });
      const roleName = (userRecord?.role?.name || '').toUpperCase();
      if (!['SUPER_ADMIN', 'HR', 'SUPERADMIN', 'ADMIN'].includes(roleName)) {
        whereClause = {
          OR: [
            { managerId: user.sub },
            ...(userRecord?.teamId ? [{ id: userRecord.teamId }] : []),
          ],
        };
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

  // Create team with manager and members in ONE atomic Prisma $transaction (HR-only)
  async create(createTeamDto: CreateTeamDto, user?: { sub: string }) {
    const { name, description, managerId, memberIds = [] } = createTeamDto;

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

    return this.prisma.$transaction(async (tx) => {
      // 1. Check duplicate team name
      const existingTeam = await tx.team.findUnique({
        where: {
          name,
        },
      });

      if (existingTeam) {
        throw new ConflictException('Team name already exists.');
      }

      // 2. Validate manager existence, active status, and eligibility
      const manager = await tx.user.findUnique({
        where: {
          id: managerId,
        },
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

      // 3. Validate members if any are selected
      if (memberIds.length > 0) {
        const members = await tx.user.findMany({
          where: {
            id: {
              in: memberIds,
            },
          },
          select: {
            id: true,
            status: true,
            teamId: true,
          },
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

      // 4. Create Team record
      const createdTeam = await tx.team.create({
        data: {
          name,
          description,
          managerId,
        },
      });

      // 5. Assign teamId to selected members
      if (memberIds.length > 0) {
        await tx.user.updateMany({
          where: {
            id: {
              in: memberIds,
            },
          },
          data: {
            teamId: createdTeam.id,
          },
        });
      }

      // 6. Return created Team with manager, members, and member count
      const teamResult = await tx.team.findUnique({
        where: {
          id: createdTeam.id,
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
          users: {
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

      if (!teamResult) {
        throw new NotFoundException('Created team not found.');
      }

      const { _count, ...rest } = teamResult;
      return {
        ...rest,
        memberCount: _count.users,
      };
    });
  }

  // Update Team (atomic transaction for team details, manager, member unassignment/reassignment, and ActivityLog)
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
      include: {
        users: {
          select: { id: true },
        },
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    // 1. Validate team name uniqueness if updated
    if (updateTeamDto.name && updateTeamDto.name.trim() !== team.name) {
      const existingName = await this.prisma.team.findUnique({
        where: { name: updateTeamDto.name.trim() },
      });
      if (existingName && existingName.id !== teamId) {
        throw new ConflictException('Team name already exists.');
      }
    }

    // 2. Validate manager if updated
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
    }

    // 3. Calculate member delta if memberIds provided
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

    // 4. Atomic Transaction execution using SAME transaction client tx
    return this.prisma.$transaction(async (tx) => {
      // A. Update team details
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

      // B. Remove users no longer in this team (set teamId = null)
      if (
        updateTeamDto.memberIds !== undefined &&
        removedMemberIds.length > 0
      ) {
        await tx.user.updateMany({
          where: {
            id: { in: removedMemberIds },
            teamId: teamId,
          },
          data: { teamId: null },
        });
      }

      // C. Assign newly added users to this team (set teamId = teamId)
      if (updateTeamDto.memberIds !== undefined && addedMemberIds.length > 0) {
        await tx.user.updateMany({
          where: {
            id: { in: addedMemberIds },
          },
          data: { teamId: teamId },
        });
      }

      // D. Create ActivityLog using SAME tx client
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

      // E. Fetch updated team object
      const updatedTeam = await tx.team.findUnique({
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
          users: {
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

      if (!updatedTeam) {
        throw new NotFoundException('Updated team not found.');
      }

      const { _count, ...rest } = updatedTeam;
      return {
        ...rest,
        memberCount: _count.users,
      };
    });
  }

  // Safe Permanent Team Deletion (unassigns members and deletes team in 1 atomic transaction)
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

    const affectedCount = team._count.users;

    await this.prisma.$transaction(async (tx) => {
      // 1. Unassign all members of this team
      await tx.user.updateMany({
        where: { teamId },
        data: { teamId: null },
      });

      // 2. Create ActivityLog using the SAME transaction client tx
      if (user?.sub) {
        await tx.activityLog.create({
          data: {
            userId: user.sub,
            activity: ActivityType.TEAM,
            entityType: 'TEAM',
            entityId: String(teamId),
            description: `Permanently deleted team ${team.name}. ${affectedCount} employee${
              affectedCount === 1 ? '' : 's'
            } moved to Unassigned.`,
          },
        });
      }

      // 3. Delete Team
      await tx.team.delete({
        where: { id: teamId },
      });
    });

    return {
      message: `Permanently deleted team ${team.name}. ${affectedCount} employee${
        affectedCount === 1 ? '' : 's'
      } moved to Unassigned.`,
    };
  }
}
