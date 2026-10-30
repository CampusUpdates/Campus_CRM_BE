import { Module } from '@nestjs/common';
import { CounsellingService } from './counselling.service';
import { CounsellingController } from './counselling.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TeamsModule } from 'src/teams/teams.module';
import { LeadsModule } from 'src/leads/leads.module';
import { AuthModule } from 'src/auth/auth.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [PrismaModule, TeamsModule, LeadsModule, AuthModule, NotificationsModule],
  controllers: [CounsellingController],
  providers: [CounsellingService],
  exports: [CounsellingService],
})
export class CounsellingModule {}
