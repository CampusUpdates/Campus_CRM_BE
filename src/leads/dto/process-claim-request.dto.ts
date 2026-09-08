import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ClaimRequestStatus } from '@prisma/client';

export class ProcessClaimRequestDto {
  @IsEnum(ClaimRequestStatus)
  status: ClaimRequestStatus;

  @IsOptional()
  @IsString()
  remarks?: string;
}
