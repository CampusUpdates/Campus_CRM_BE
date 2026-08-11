import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Min,
  Max,
} from 'class-validator';

import { Gender, LeadSource, CourseType } from '@prisma/client';

export class CreateLeadDto {
  @IsString()
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  dateOfBirth?: Date;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tenthPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  twelfthPercentage?: number;

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
  @IsInt()
  passingYear?: number;

  @IsEnum(LeadSource)
  source!: LeadSource;
}