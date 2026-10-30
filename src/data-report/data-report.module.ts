import { Module } from '@nestjs/common';
import { DataReportService } from './data-report.service';
import { DataReportController } from './data-report.controller';

@Module({
  providers: [DataReportService],
  controllers: [DataReportController]
})
export class DataReportModule { }
