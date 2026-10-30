import { Test, TestingModule } from '@nestjs/testing';
import { DataReportService } from './data-report.service';

describe('DataReportService', () => {
  let service: DataReportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataReportService],
    }).compile();

    service = module.get<DataReportService>(DataReportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
