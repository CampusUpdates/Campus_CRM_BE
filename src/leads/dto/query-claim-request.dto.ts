import { IsEnum, IsOptional } from 'class-validator';
import { ClaimRequestStatus } from '@prisma/client';

export class QueryClaimRequestDto {
  @IsOptional()
  @IsEnum(ClaimRequestStatus)
  status?: ClaimRequestStatus;
}
