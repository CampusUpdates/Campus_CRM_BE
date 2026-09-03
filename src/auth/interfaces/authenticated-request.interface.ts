import { Request } from 'express';
import { PermissionScope } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  firstName: string;
  lastName?: string | null;
  roleId: number;
  teamId?: number | null;
  type: string;
}

export type UserPermissionsMap = Record<string, PermissionScope>;

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
  userPermissions?: UserPermissionsMap;
}
