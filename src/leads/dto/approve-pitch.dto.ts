import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CollegeStatus } from '@prisma/client';

export class ApprovePitchDto {
  @IsEnum(CollegeStatus)
  status!: CollegeStatus;

  @IsOptional()
  @IsString()
  remarks?: string;
}
