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

    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization token missing');
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization header');
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
