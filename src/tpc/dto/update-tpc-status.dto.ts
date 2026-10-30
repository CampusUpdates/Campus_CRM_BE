import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TPCUserStatus, CallOutcome } from '@prisma/client';

export class UpdateTpcStatusDto {
  @IsOptional()
  @IsEnum(TPCUserStatus)
  status?: TPCUserStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(CallOutcome)
  outcome?: CallOutcome;
}
