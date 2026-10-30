import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadReallocationService } from './lead-reallocation.service';
import { AuthModule } from 'src/auth/auth.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { TeamsModule } from 'src/teams/teams.module';

@Module({
  imports: [AuthModule, NotificationsModule, TeamsModule],
  controllers: [LeadsController],
  providers: [LeadsService, LeadReallocationService],
  exports: [LeadsService],
})
export class LeadsModule {}
