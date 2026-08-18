import { Module } from '@nestjs/common';
import { LeadStatusController } from './lead-status.controller';
import { LeadStatusService } from './lead-status.service';

@Module({
  controllers: [LeadStatusController],
  providers: [LeadStatusService],
})
export class LeadStatusModule {}
