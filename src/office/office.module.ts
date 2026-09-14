import { Module, forwardRef } from '@nestjs/common';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';
import { GeofenceService } from './geofence.service';
import { AuthModule } from 'src/auth/auth.module';
import { ActivityLogModule } from 'src/activity-log/activity-log.module';

@Module({
  imports: [forwardRef(() => AuthModule), ActivityLogModule],
  controllers: [OfficeController],
  providers: [OfficeService, GeofenceService],
  exports: [OfficeService, GeofenceService],
})
export class OfficeModule {}
