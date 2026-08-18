import { Request } from 'express';

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

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
