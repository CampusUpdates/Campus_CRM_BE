import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePositionDto {
  @IsString()
  title!: string;

  @IsString()
  department!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  vacancies?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
