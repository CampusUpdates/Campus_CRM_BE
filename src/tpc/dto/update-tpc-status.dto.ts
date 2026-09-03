import { IsEnum } from 'class-validator';
import { TPCUserStatus } from '@prisma/client';

export class UpdateTpcStatusDto {
  @IsEnum(TPCUserStatus)
  status: TPCUserStatus;
}
