import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { TeamsModule } from './teams/teams.module';
import { CollegesModule } from './colleges/colleges.module';
import { CoursesModule } from './courses/courses.module';
import { CompetitorsModule } from './competitors/competitors.module';
import { LeadsModule } from './leads/leads.module';
import { TpcModule } from './tpc/tpc.module';
import { CandidatesModule } from './candidates/candidates.module';
import { InterviewsModule } from './interviews/interviews.module';
import { UploadsModule } from './uploads/uploads.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { OfficeModule } from './office/office.module';
import { LeadStatusModule } from './lead-status/lead-status.module';
import { PositionsModule } from './positions/positions.module';
import { CommonModule } from './common/common.module';
import { PermissionsModule } from './permissions/permissions.module';
import { ReportsModule } from './reports/reports.module';
import { InteractionsModule } from './interactions/interactions.module';
import { TodosModule } from './todos/todos.module';
import { CallsModule } from './calls/calls.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    RolesModule,
    TeamsModule,
    CollegesModule,
    CoursesModule,
    CompetitorsModule,
    LeadsModule,
    TpcModule,
    InteractionsModule,
    TodosModule,
    CandidatesModule,
    InterviewsModule,
    UploadsModule,
    NotificationsModule,
    AttendanceModule,
    DashboardModule,
    ActivityLogModule,
    PrismaModule,
    OfficeModule,
    LeadStatusModule,
    PositionsModule,
    CommonModule,
    PermissionsModule,
    ReportsModule,
    CallsModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
