import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { CallOutcome } from '@prisma/client';

export class CreateCallOutcomeDto {
  @IsNotEmpty()
  @IsUUID()
  studentDataId: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsNotEmpty()
  @IsEnum(CallOutcome)
  outcome: CallOutcome;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;
}
