import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export enum AssignmentStatusFilter {
  AVAILABLE = 'AVAILABLE',
  ASSIGNED = 'ASSIGNED',
  ALL = 'ALL',
}

export class FilterStudentDataDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
    return [String(value)];
  })
  @IsArray()
  @IsString({ each: true })
  states?: string[];

  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
    return [String(value)];
  })
  @IsArray()
  @IsString({ each: true })
  cities?: string[];

  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
    return [String(value)];
  })
  @IsArray()
  @IsString({ each: true })
  uploadIds?: string[];

  @IsOptional()
  @IsEnum(AssignmentStatusFilter)
  assignmentStatus?: AssignmentStatusFilter = AssignmentStatusFilter.AVAILABLE;

  @IsOptional()
  @IsString()
  search?: string;

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
