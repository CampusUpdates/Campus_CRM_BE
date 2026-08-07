import { Module } from '@nestjs/common';
import { ValidationService } from './constants/services/validation.service';

@Module({
  providers: [ValidationService],
  exports: [ValidationService],
})
export class CommonModule {}