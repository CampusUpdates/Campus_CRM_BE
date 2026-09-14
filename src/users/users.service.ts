import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from 'src/users/dto/create-user.dto';
import { ERROR_MESSAGES } from '../common/constants/error-message';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { USER_SAFE_SELECT } from 'src/common/constants/constants.user';

import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { ActivityType, UserStatus } from '@prisma/client';
import { ReplaceSuperAdminDto } from './dto/replace-super-admin.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly activityLogService: ActivityLogService,
  ) {}

  // Helper: Get SUPER_ADMIN role record
  private async getSuperAdminRole() {
    return this.prisma.role.findUnique({
      where: { name: 'SUPER_ADMIN' },
    });
  }

  // Helper: Count active Super Admin users
  private async countActiveSuperAdmins(): Promise<number> {
    const superAdminRole = await this.getSuperAdminRole();
    if (!superAdminRole) return 0;

    return this.prisma.user.count({
      where: {
        roleId: superAdminRole.id,
        status: UserStatus.ACTIVE,
      },
    });
  }

  // Helper: Check if a user has the HR role
  private async isUserHR(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    return user?.role?.name === 'HR';
  }

  // Get all users
  async findAll() {
    return this.prisma.user.findMany({
      select: USER_SAFE_SELECT,
    });
  }

  // Generate username
  private async generateUsername(
    firstName: string,
    lastName?: string,
  ): Promise<string> {
    const baseUsername = `${firstName}${lastName ?? ''}`
      .toLowerCase()
      .replace(/\s+/g, '');

    let username = baseUsername;
    let counter = 1;

    while (
      await this.prisma.user.findUnique({
        where: { username },
      })
    ) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    return username;
  }

  // Generate password
  private generateTemporaryPassword(): string {
    return randomBytes(8).toString('base64url');
  }

  // Create user
  async create(
    createUserDto: CreateUserDto,
    callingUser?: { sub: string; roleId: number },
  ) {
    // Duplicate Email / Phone Check
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: createUserDto.email }, { phone: createUserDto.phone }],
      },
    });

    if (existingUser) {
      if (existingUser.email === createUserDto.email) {
        throw new ConflictException(ERROR_MESSAGES.EMAIL_ALREADY_EXISTS);
      }

      throw new ConflictException(ERROR_MESSAGES.PHONE_ALREADY_EXISTS);
    }

    // Validate Role
    const role = await this.prisma.role.findUnique({
      where: {
        id: createUserDto.roleId,
      },
    });

    if (!role) {
      throw new NotFoundException(ERROR_MESSAGES.ROLE_NOT_FOUND);
    }

    // Super Admin Protection Rules
    const superAdminRole = await this.getSuperAdminRole();
    if (superAdminRole && createUserDto.roleId === superAdminRole.id) {
      if (callingUser) {
        const isHR = await this.isUserHR(callingUser.sub);
        if (isHR) {
          throw new ForbiddenException(
            'You do not have permission to assign the Super Admin role.',
          );
        }
      }

      const activeSuperAdminCount = await this.countActiveSuperAdmins();
      if (activeSuperAdminCount >= 1) {
        throw new ConflictException('An active Super Admin already exists.');
      }
    }

    // Validate Team
    if (createUserDto.teamId) {
      const team = await this.prisma.team.findUnique({
        where: {
          id: createUserDto.teamId,
        },
      });

      if (!team) {
        throw new NotFoundException(ERROR_MESSAGES.TEAM_NOT_FOUND);
      }
    }

    // Generate Username
    const username = await this.generateUsername(
      createUserDto.firstName,
      createUserDto.lastName,
    );

    // Generate Temporary Password
    const temporaryPassword = this.generateTemporaryPassword();

    // Hash Temporary Password
    const passwordHash = await argon2.hash(temporaryPassword);

    // Create User
    const newUser = await this.prisma.user.create({
      data: {
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        email: createUserDto.email,
        phone: createUserDto.phone,
        alternatePhone: createUserDto.alternatePhone,
        dob: createUserDto.dob ? new Date(createUserDto.dob) : undefined,
        username,
        passwordHash,
        roleId: createUserDto.roleId,
        teamId: createUserDto.teamId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roleId: true,
      },
    });

    const temporaryToken = await this.jwtService.signAsync(
      {
        sub: newUser.id,
        email: newUser.email,
        username,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        roleId: newUser.roleId,
        type: 'temporary',
      },
      {
        expiresIn: '24h',
      },
    );

    return {
      id: newUser.id,
      username,
      temporaryPassword,
      temporaryToken,
    };
  }

  // Find by ID
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SAFE_SELECT,
    });

    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return user;
  }

  // Get Self Profile
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        team: true,
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
            createdLeads: true,
            conductedInterviews: true,
            attendance: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found.');
    }

    const { passwordHash, ...result } = user;
    return result;
  }

  // Update Self Profile (Restricted to HR / Super Admin)
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!existing) {
      throw new NotFoundException('User not found.');
    }

    // Only HR or SUPER_ADMIN personnel are authorized to update profile details
    if (existing.role.name !== 'HR' && existing.role.name !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Only HR personnel are authorized to edit profile details. Contact HR to update your information.',
      );
    }

    if (dto.phone && dto.phone !== existing.phone) {
      const duplicatePhone = await this.prisma.user.findUnique({
        where: { phone: dto.phone },
      });
      if (duplicatePhone) {
        throw new ConflictException(ERROR_MESSAGES.PHONE_ALREADY_EXISTS);
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        alternatePhone: dto.alternatePhone,
        dob: dto.dob ? new Date(dto.dob) : undefined,
      },
      include: {
        role: true,
        team: true,
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
            createdLeads: true,
            conductedInterviews: true,
            attendance: true,
          },
        },
      },
    });

    const { passwordHash, ...result } = updatedUser;
    return result;
  }

  // Admin update user
  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    currentUserId?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });

    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    if (updateUserDto.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: updateUserDto.email },
      });

      if (existingEmail && existingEmail.id !== id) {
        throw new ConflictException(ERROR_MESSAGES.EMAIL_ALREADY_EXISTS);
      }
    }

    if (updateUserDto.phone) {
      const existingPhone = await this.prisma.user.findUnique({
        where: { phone: updateUserDto.phone },
      });

      if (existingPhone && existingPhone.id !== id) {
        throw new ConflictException(ERROR_MESSAGES.PHONE_ALREADY_EXISTS);
      }
    }

    const superAdminRole = await this.getSuperAdminRole();
    const superAdminRoleId = superAdminRole?.id;
    const isUserCurrentlyActiveSuperAdmin =
      superAdminRoleId &&
      user.roleId === superAdminRoleId &&
      user.status === UserStatus.ACTIVE;

    if (updateUserDto.roleId !== undefined) {
      const role = await this.prisma.role.findUnique({
        where: { id: updateUserDto.roleId },
      });

      if (!role) {
        throw new NotFoundException(ERROR_MESSAGES.ROLE_NOT_FOUND);
      }

      if (superAdminRoleId) {
        const isTargetSuperAdmin = updateUserDto.roleId === superAdminRoleId;

        if (isTargetSuperAdmin && !isUserCurrentlyActiveSuperAdmin) {
          if (currentUserId) {
            const isHR = await this.isUserHR(currentUserId);
            if (isHR) {
              throw new ForbiddenException(
                'You do not have permission to assign the Super Admin role.',
              );
            }
          }

          const activeSuperAdminCount = await this.countActiveSuperAdmins();
          if (activeSuperAdminCount >= 1) {
            throw new ConflictException(
              'An active Super Admin already exists. Another user cannot be assigned the Super Admin role.',
            );
          }
        } else if (!isTargetSuperAdmin && isUserCurrentlyActiveSuperAdmin) {
          const activeSuperAdminCount = await this.countActiveSuperAdmins();
          if (activeSuperAdminCount <= 1) {
            throw new ConflictException(
              'Cannot demote the only active Super Admin. System must have at least one active Super Admin.',
            );
          }
        }
      }
    }

    if (updateUserDto.teamId !== undefined && updateUserDto.teamId !== null) {
      const team = await this.prisma.team.findUnique({
        where: { id: updateUserDto.teamId },
      });

      if (!team) {
        throw new NotFoundException(ERROR_MESSAGES.TEAM_NOT_FOUND);
      }

      if (!team.isActive) {
        throw new BadRequestException(
          'This team is inactive and cannot receive new members.',
        );
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: updateUserDto.firstName,
        lastName: updateUserDto.lastName,
        email: updateUserDto.email,
        phone: updateUserDto.phone,
        alternatePhone: updateUserDto.alternatePhone,
        dob: updateUserDto.dob ? new Date(updateUserDto.dob) : undefined,
        roleId: updateUserDto.roleId,
        teamId: updateUserDto.teamId,
        managerId: updateUserDto.managerId,
      },
      select: USER_SAFE_SELECT,
    });

    if (currentUserId) {
      const userName =
        `${updatedUser.firstName} ${updatedUser.lastName || ''}`.trim();
      if (
        updateUserDto.roleId !== undefined &&
        updateUserDto.roleId !== user.roleId
      ) {
        const newRoleObj = await this.prisma.role.findUnique({
          where: { id: updateUserDto.roleId },
        });
        if (newRoleObj?.name === 'SUPER_ADMIN') {
          await this.activityLogService.createLog({
            userId: currentUserId,
            activity: ActivityType.USER,
            entityType: 'USER',
            entityId: id,
            description: `User ${userName} was promoted to Super Admin.`,
          });
        } else if (user.role?.name === 'SUPER_ADMIN') {
          await this.activityLogService.createLog({
            userId: currentUserId,
            activity: ActivityType.USER,
            entityType: 'USER',
            entityId: id,
            description: `User ${userName} was demoted from Super Admin to ${newRoleObj?.name || 'another role'}.`,
          });
        }
      } else {
        await this.activityLogService.createLog({
          userId: currentUserId,
          activity: ActivityType.USER,
          entityType: 'USER',
          entityId: id,
          description: `Updated employee profile for ${userName}`,
        });
      }
    }

    return updatedUser;
  }

  // Update User Team (Assign, Move, or Unassign)
  async updateTeam(id: string, teamId: number | null, currentUserId?: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
      include: { team: true },
    });

    if (!existingUser) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    let targetTeamName = '';

    if (teamId !== null) {
      const team = await this.prisma.team.findUnique({
        where: { id: teamId },
      });

      if (!team) {
        throw new NotFoundException(ERROR_MESSAGES.TEAM_NOT_FOUND);
      }

      if (!team.isActive) {
        throw new BadRequestException(
          'This team is inactive and cannot receive new members.',
        );
      }

      targetTeamName = team.name;
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: { teamId },
      select: USER_SAFE_SELECT,
    });

    if (currentUserId && existingUser.teamId !== teamId) {
      const userName =
        `${existingUser.firstName} ${existingUser.lastName || ''}`.trim();
      let description = '';

      if (teamId === null) {
        description =
          `Removed ${userName} from Team ${existingUser.team?.name || ''}`.trim();
      } else if (!existingUser.teamId) {
        description = `Assigned ${userName} to Team ${targetTeamName}`.trim();
      } else {
        description =
          `Moved ${userName} from Team ${existingUser.team?.name || ''} to Team ${targetTeamName}`.trim();
      }

      await this.activityLogService.createLog({
        userId: currentUserId,
        activity: ActivityType.USER,
        entityType: 'USER',
        entityId: id,
        description,
      });
    }

    return updatedUser;
  }

  // Update User Status
  async updateStatus(id: string, status: UserStatus, currentUserId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });

    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    if (currentUserId && id === currentUserId && status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }

    const superAdminRole = await this.getSuperAdminRole();
    if (
      superAdminRole &&
      user.roleId === superAdminRole.id &&
      user.status === UserStatus.ACTIVE &&
      status !== UserStatus.ACTIVE
    ) {
      const activeSuperAdminCount = await this.countActiveSuperAdmins();
      if (activeSuperAdminCount <= 1) {
        throw new ConflictException(
          'Cannot deactivate the only active Super Admin. System must have at least one active Super Admin.',
        );
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: { status },
      select: USER_SAFE_SELECT,
    });

    if (currentUserId) {
      let description =
        `Changed status to ${status} for employee ${updatedUser.firstName} ${updatedUser.lastName || ''}`.trim();
      if (status === UserStatus.INACTIVE) {
        description =
          `Deactivated employee ${updatedUser.firstName} ${updatedUser.lastName || ''}`.trim();
      } else if (status === UserStatus.ACTIVE) {
        description =
          `Activated employee ${updatedUser.firstName} ${updatedUser.lastName || ''}`.trim();
      }

      await this.activityLogService.createLog({
        userId: currentUserId,
        activity: ActivityType.USER,
        entityType: 'USER',
        entityId: id,
        description,
      });
    }

    return updatedUser;
  }

  // Safe Atomic Super Admin Replacement
  async replaceSuperAdmin(dto: ReplaceSuperAdminDto, currentUserId: string) {
    const superAdminRole = await this.getSuperAdminRole();
    if (!superAdminRole) {
      throw new NotFoundException('Super Admin role not found.');
    }

    const callingUser = await this.prisma.user.findUnique({
      where: { id: currentUserId },
    });
    if (
      !callingUser ||
      callingUser.roleId !== superAdminRole.id ||
      callingUser.status !== UserStatus.ACTIVE
    ) {
      throw new ForbiddenException(
        'Only an active Super Admin can perform Super Admin replacement.',
      );
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.newSuperAdminId },
      include: { role: true },
    });
    if (!targetUser) {
      throw new NotFoundException('Target replacement user not found.');
    }
    if (targetUser.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Target replacement user must be ACTIVE.');
    }

    const demotedRole = await this.prisma.role.findUnique({
      where: { id: dto.newRoleForPreviousAdminId },
    });
    if (!demotedRole) {
      throw new NotFoundException('Specified demotion role not found.');
    }
    if (demotedRole.id === superAdminRole.id) {
      throw new BadRequestException('Demoted role cannot be SUPER_ADMIN.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Demote current Super Admin
      await tx.user.update({
        where: { id: currentUserId },
        data: { roleId: demotedRole.id },
      });

      // Promote target user to Super Admin
      const newSuperAdmin = await tx.user.update({
        where: { id: dto.newSuperAdminId },
        data: { roleId: superAdminRole.id },
        select: USER_SAFE_SELECT,
      });

      const oldAdminName =
        `${callingUser.firstName} ${callingUser.lastName || ''}`.trim();
      const newAdminName =
        `${targetUser.firstName} ${targetUser.lastName || ''}`.trim();

      // Log activity inside transaction
      await tx.activityLog.create({
        data: {
          userId: currentUserId,
          activity: ActivityType.USER,
          entityType: 'USER',
          entityId: dto.newSuperAdminId,
          description: `User ${newAdminName} was promoted to Super Admin.`,
        },
      });

      await tx.activityLog.create({
        data: {
          userId: currentUserId,
          activity: ActivityType.USER,
          entityType: 'USER',
          entityId: currentUserId,
          description: `User ${oldAdminName} was demoted from Super Admin to ${demotedRole.name}.`,
        },
      });

      return newSuperAdmin;
    });
  }

  // Deactivate user
  async deactivate(id: string, currentUserId?: string) {
    return this.updateStatus(id, UserStatus.INACTIVE, currentUserId);
  }

  // Reactivate user
  async activate(id: string, currentUserId?: string) {
    return this.updateStatus(id, UserStatus.ACTIVE, currentUserId);
  }
}
