import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from 'src/users/dto/crete-user.dto';
import { ERROR_MESSAGES } from '../common/constants/error-message'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Get all users
  async findAll() {
    const users = await this.prisma.user.findMany();

    return users;
  }

  // Create user
  async create(createUserDto: CreateUserDto) {
    // ------------------------------------------------
    // Duplicate Email / Phone Check
    // ------------------------------------------------

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: createUserDto.email },
          { phone: createUserDto.phone },
        ],
      },
    });

    if (existingUser) {
      if (existingUser.email === createUserDto.email) {
        throw new ConflictException(ERROR_MESSAGES.EMAIL_ALREADY_EXISTS);
      }

      throw new ConflictException(ERROR_MESSAGES.PHONE_ALREADY_EXISTS);
    }

    // ------------------------------------------------
    // Validate Role
    // ------------------------------------------------

    const role = await this.prisma.role.findUnique({
      where: {
        id: createUserDto.roleId,
      },
    });

    if (!role) {
      throw new NotFoundException(ERROR_MESSAGES.ROLE_NOT_FOUND);
    }

    // ------------------------------------------------
    // Validate Team
    // ------------------------------------------------

    const team = await this.prisma.team.findUnique({
      where: {
        id: createUserDto.teamId,
      },
    });

    if (!team) {
      throw new NotFoundException(ERROR_MESSAGES.TEAM_NOT_FOUND);
    }

    // ------------------------------------------------
    // Validate Manager (Optional)
    // ------------------------------------------------

    if (createUserDto.managerId) {
      const manager = await this.prisma.user.findUnique({
        where: {
          id: createUserDto.managerId,
        },
      });

      if (!manager) {
        throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
      }
    }

    // ------------------------------------------------
    // NEXT STEPS
    // ------------------------------------------------

    // Generate Employee Code

    // Generate Username

    // Generate Temporary Password

    // Hash Temporary Password

    // Create User

    // Return Created User
  }
}