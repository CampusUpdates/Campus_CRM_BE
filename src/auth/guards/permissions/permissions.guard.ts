import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/prisma/prisma.service';
import { Request } from 'express';
import { JwtPayload } from '../../interfaces/authenticated-request.interface';
import { PERMISSIONS_KEY } from 'src/permissions/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Route doesn't require a permission
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const userPayload = request.user;

    if (!userPayload || !userPayload.sub) {
      throw new UnauthorizedException('User authentication required');
    }

    // Verify user exists and is active in database
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userPayload.sub },
      select: {
        id: true,
        status: true,
        roleId: true,
        role: {
          select: {
            id: true,
            name: true,
            isActive: true,
          },
        },
      },
    });

    if (!dbUser || dbUser.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is inactive or suspended');
    }

    if (!dbUser.role || !dbUser.role.isActive) {
      throw new ForbiddenException('User role is inactive or missing');
    }

    const userPermissions = await this.prisma.rolePermission.findMany({
      where: {
        roleId: dbUser.roleId,
        permission: {
          name: {
            in: requiredPermissions,
          },
          isActive: true,
        },
      },
      select: {
        permission: {
          select: {
            name: true,
          },
        },
      },
    });

    const permissionNames = userPermissions.map((item) => item.permission.name);

    const hasAllPermissions = requiredPermissions.every((permission) =>
      permissionNames.includes(permission),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException('Access denied: Insufficient permissions');
    }

    return true;
  }
}
