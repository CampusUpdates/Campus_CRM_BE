import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OfficeModule } from 'src/office/office.module';
import { AttendanceClassificationService } from 'src/attendance/attendance-classification.service';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    forwardRef(() => OfficeModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '1d',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AttendanceClassificationService, PasswordResetService],
  exports: [JwtModule, AuthService],
})
export class AuthModule {}
