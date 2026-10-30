import { Test, TestingModule } from '@nestjs/testing';
import { DataReportController } from './data-report.controller';

describe('DataReportController', () => {
  let controller: DataReportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataReportController],
    }).compile();

    controller = module.get<DataReportController>(DataReportController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
