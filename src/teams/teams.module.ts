import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { TeamLeadAuthorizationService } from './team-lead-authorization.service';
import { AuthModule } from 'src/auth/auth.module';
import { ActivityLogModule } from 'src/activity-log/activity-log.module';

@Module({
  imports: [AuthModule, ActivityLogModule],
  providers: [TeamsService, TeamLeadAuthorizationService],
  controllers: [TeamsController],
  exports: [TeamsService, TeamLeadAuthorizationService],
})
export class TeamsModule {}
