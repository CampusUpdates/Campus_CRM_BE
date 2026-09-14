import { Module } from '@nestjs/common';
import { CollegesController } from './colleges.controller';
import { CollegesService } from './colleges.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ActivityLogModule } from 'src/activity-log/activity-log.module';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule, ActivityLogModule],
  controllers: [CollegesController],
  providers: [CollegesService],
  exports: [CollegesService],
})
export class CollegesModule {}
