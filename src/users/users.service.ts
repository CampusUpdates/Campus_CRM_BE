import {
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

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

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
  async create(createUserDto: CreateUserDto) {
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
  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
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

    if (updateUserDto.roleId !== undefined) {
      const role = await this.prisma.role.findUnique({
        where: { id: updateUserDto.roleId },
      });

      if (!role) {
        throw new NotFoundException(ERROR_MESSAGES.ROLE_NOT_FOUND);
      }
    }

    if (updateUserDto.teamId !== undefined) {
      const team = await this.prisma.team.findUnique({
        where: { id: updateUserDto.teamId },
      });

      if (!team) {
        throw new NotFoundException(ERROR_MESSAGES.TEAM_NOT_FOUND);
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
    });

    return updatedUser;
  }

  // Deactivate user
  async deactivate(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        status: 'INACTIVE',
      },
      select: USER_SAFE_SELECT,
    });
  }

  // Reactivate user
  async activate(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        status: 'ACTIVE',
      },
      select: USER_SAFE_SELECT,
    });
  }
}
