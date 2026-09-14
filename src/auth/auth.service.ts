import {
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as argon2 from 'argon2';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ERROR_MESSAGES } from 'src/common/constants/error-message';
import { OfficeService } from 'src/office/office.service';
import { GeofenceService } from 'src/office/geofence.service';
import { AttendanceClassificationService } from 'src/attendance/attendance-classification.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => OfficeService))
    private readonly officeService: OfficeService,
    private readonly geofenceService: GeofenceService,
    private readonly classificationService: AttendanceClassificationService,
  ) {}

  // Login
  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        username: loginDto.username,
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      loginDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account status is ACTIVE
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Your account is inactive. Please contact an administrator.',
      );
    }

    // Location bypass based on RBAC permission
    const hasBypassPermission = user.role?.permissions?.some(
      (rp) => rp.permission.name === 'BYPASS_OFFICE_VALIDATION',
    );

    if (!hasBypassPermission) {
      // Validate latitude and longitude were sent by client
      if (
        loginDto.latitude === undefined ||
        loginDto.latitude === null ||
        loginDto.longitude === undefined ||
        loginDto.longitude === null ||
        typeof loginDto.latitude !== 'number' ||
        typeof loginDto.longitude !== 'number' ||
        isNaN(loginDto.latitude) ||
        isNaN(loginDto.longitude)
      ) {
        throw new UnauthorizedException(
          'Location permission is required to log in.',
        );
      }

      // Fetch active offices with configured coordinates
      const activeOffices =
        await this.officeService.findActiveConfiguredOffices();

      if (!activeOffices || activeOffices.length === 0) {
        throw new UnauthorizedException(
          'Your current location could not be verified.',
        );
      }

      // Find nearest office where user is inside radius
      const matched = this.geofenceService.findNearestMatchingOffice(
        loginDto.latitude,
        loginDto.longitude,
        activeOffices,
      );

      if (!matched) {
        throw new UnauthorizedException(
          'You must be inside an authorized office to log in.',
        );
      }

      // Fetch active policy for the matched office
      const policy = await this.prisma.attendancePolicy.findUnique({
        where: { officeId: matched.office.id },
      });

      if (!policy || !policy.isActive) {
        throw new UnauthorizedException(
          'No active attendance policy configured for this office.',
        );
      }

      // Record / update today's attendance record safely using unique constraint
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const loginTime = new Date();
      const status = this.classificationService.classifyAttendance(
        loginTime,
        policy,
      );

      try {
        await this.prisma.attendance.create({
          data: {
            userId: user.id,
            officeId: matched.office.id,
            date: startOfToday,
            checkIn: loginTime,
            status: status,
          },
        });
      } catch (error) {
        // P2002: Unique constraint failed on the fields: (`userId`,`date`)
        if (error.code === 'P2002') {
          // A concurrent or prior login today has already successfully created the record.
          // We safely ignore this to ensure the FIRST login's status is preserved.
        } else {
          throw error;
        }
      }
    }

    if (user.mustChangePassword) {
      const payload = {
        sub: user.id,
        type: 'password-change',
      };

      const passwordChangeToken = await this.jwtService.signAsync(payload);

      return {
        requiresPasswordChange: true,
        passwordChangeToken,
      };
    }

    const payload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      teamId: user.teamId,
      type: 'access',
    };

    const access_token = await this.jwtService.signAsync(payload);

    return {
      message: 'Login successful',
      access_token,
    };
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      changePasswordDto.oldPassword,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    const newPasswordHash = await argon2.hash(changePasswordDto.newPassword);

    await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
      },
    });

    return {
      message: 'Password changed successfully',
    };
  }
}
