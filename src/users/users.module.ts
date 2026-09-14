import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from 'src/auth/auth.module';
import { ActivityLogModule } from 'src/activity-log/activity-log.module';

@Module({
  imports: [AuthModule, ActivityLogModule],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
