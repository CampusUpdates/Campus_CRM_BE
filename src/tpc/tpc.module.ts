import { Module } from '@nestjs/common';
import { TpcController } from './tpc.controller';
import { TpcService } from './tpc.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  controllers: [TpcController],
  providers: [TpcService],
  exports: [TpcService],
})
export class TpcModule {}
