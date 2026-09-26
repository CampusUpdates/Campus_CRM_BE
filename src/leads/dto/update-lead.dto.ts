import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { CourseType, Gender } from '@prisma/client';

export class UpdateLeadDto {
  @IsOptional()
  @IsNumber()
  statusId?: number;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  dateOfBirth?: Date;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tenthPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  graduationPercentage?: number;

  @IsOptional()
  @IsString()
  graduationCourse?: string;

  @IsOptional()
  @IsString()
  graduationSpecialization?: string;

  @IsOptional()
  @IsEnum(CourseType)
  courseInterested?: CourseType;

  @IsOptional()
  @IsString()
  specializationInterested?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  collegeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Every negative college ID must be a valid UUID' })
  negativeCollegeIds?: string[];
}
