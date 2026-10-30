import { IsOptional, IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class GetTpcReportDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  teamId?: number;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  status?: string; // 'ALL', 'PENDING', 'COMPLETED', 'NOT_ASSIGNED'

  @IsOptional()
  @IsString()
  period?: string; // 'today', 'yesterday', '7days', '30days', 'all'

  @IsOptional()
  @IsString()
  search?: string;
}
