import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum AssignmentStatusFilter {
  ALL = 'ALL',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  UNASSIGNED = 'UNASSIGNED',
}

export class ReallocationQueryDto {
  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  leadStatus?: string;

  @IsOptional()
  @IsEnum(AssignmentStatusFilter)
  assignmentStatus?: AssignmentStatusFilter;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  createdFrom?: string;

  @IsOptional()
  @IsString()
  createdTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
