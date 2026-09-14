import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceFinalizerService } from './attendance-finalizer.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceFinalizerService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
