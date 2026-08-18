import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from 'src/users/dto/create-user.dto';
import { ERROR_MESSAGES } from '../common/constants/error-message';
import { UpdateUserDto } from './dto/update-user.dto';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { USER_SAFE_SELECT } from 'src/common/constants/constants.user';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Get all users
  async findAll() {
    return this.prisma.user.findMany({
      select: USER_SAFE_SELECT,
    });
  }
  //generate username
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

  //generate password

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
    await this.prisma.user.create({
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
        username: true,
      },
    });
    // Return Created User

    return {
      username,
      temporaryPassword,
    };
  }

  //find by id
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
      },
      select: USER_SAFE_SELECT,
    });

    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return user;
  }

  //update user

  async update(id: string, updateUserDto: UpdateUserDto) {
    // 1. Check user exists
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

    // 3. Validate role if provided
    if (updateUserDto.roleId !== undefined) {
      const role = await this.prisma.role.findUnique({
        where: { id: updateUserDto.roleId },
      });

      if (!role) {
        throw new NotFoundException(ERROR_MESSAGES.ROLE_NOT_FOUND);
      }
    }

    // 4. Validate team if provided
    if (updateUserDto.teamId !== undefined) {
      const team = await this.prisma.team.findUnique({
        where: { id: updateUserDto.teamId },
      });

      if (!team) {
        throw new NotFoundException(ERROR_MESSAGES.TEAM_NOT_FOUND);
      }
    }

    // 5. Update user
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

  //deactivate user

  async deactivate(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        status: 'INACTIVE',
      },
      select: USER_SAFE_SELECT,
    });

    return updatedUser;
  }

  //reactivate user

  async activate(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        status: 'ACTIVE',
      },
      select: USER_SAFE_SELECT,
    });

    return updatedUser;
  }
}
