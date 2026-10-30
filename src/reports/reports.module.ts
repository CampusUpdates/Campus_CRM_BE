import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TeamsModule } from 'src/teams/teams.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [PrismaModule, TeamsModule, AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}


