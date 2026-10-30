import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtPayload } from '../interfaces/authenticated-request.interface';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();

    let token: string | undefined;
    const authHeader = request.headers.authorization;

    if (authHeader) {
      const [type, bearerToken] = authHeader.split(' ');
      if (type === 'Bearer' && bearerToken) {
        token = bearerToken;
      }
    }

    if (!token && typeof request.query?.token === 'string') {
      token = request.query.token;
    }

    if (!token) {
      throw new UnauthorizedException('Authorization token missing');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      if (payload.type !== 'access') {
        throw new UnauthorizedException('Invalid token type');
      }

      const dbUser = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { status: true },
      });

      if (!dbUser || dbUser.status !== 'ACTIVE') {
        throw new UnauthorizedException(
          'User account is inactive or suspended',
        );
      }

      request.user = payload;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
