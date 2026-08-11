import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      'permissions',
      [context.getHandler(), context.getClass()],
    );

    // Route doesn't require a permission
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Super Admin has unrestricted access
    const role = await this.prisma.role.findUnique({
      where: {
        id: user.roleId,
      },
      select: {
        name: true,
      },
    });

    if (role?.name === 'SUPER_ADMIN') {
      return true;
    }

    const userPermissions = await this.prisma.rolePermission.findMany({
      where: {
        roleId: user.roleId,
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

    const permissionNames = userPermissions.map(
      (item) => item.permission.name,
    );

    const hasPermission = requiredPermissions.every((permission) =>
      permissionNames.includes(permission),
    );

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}