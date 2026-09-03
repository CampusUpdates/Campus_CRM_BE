import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthenticatedRequest } from '../../interfaces/authenticated-request.interface';
import { PERMISSIONS_KEY } from 'src/permissions/permissions.decorator';
import { PermissionScope } from '@prisma/client';

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

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
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

    // Fetch all active permissions for user's role
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: {
        roleId: dbUser.roleId,
        permission: {
          isActive: true,
        },
      },
      select: {
        scope: true,
        permission: {
          select: {
            name: true,
          },
        },
      },
    });

    const userPermissionsMap: Record<string, PermissionScope> = {};
    for (const rp of rolePermissions) {
      userPermissionsMap[rp.permission.name] = rp.scope;
    }

    // Super Admin receives ALL scope for all system permissions
    if (dbUser.role.name === 'SUPER_ADMIN') {
      const allPermissions = await this.prisma.permission.findMany({
        where: { isActive: true },
        select: { name: true },
      });
      for (const p of allPermissions) {
        userPermissionsMap[p.name] = PermissionScope.ALL;
      }
    }

    request.userPermissions = userPermissionsMap;

    // Route doesn't require specific permission
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const hasAllPermissions = requiredPermissions.every(
      (permission) => userPermissionsMap[permission] !== undefined,
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException('Access denied: Insufficient permissions');
    }

    return true;
  }
}
