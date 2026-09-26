import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
} from 'class-validator';

import { Gender, LeadSource, CourseType } from '@prisma/client';

export class CreateLeadDto {
  @IsNotEmpty({ message: 'First name is required' })
  @IsString()
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsNotEmpty({ message: 'Email address is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email!: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsNotEmpty({ message: 'City is required' })
  @IsString()
  city!: string;

  @IsNotEmpty({ message: 'State is required' })
  @IsString()
  state!: string;

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

  @IsArray({ message: 'At least one college must be selected' })
  @ArrayMinSize(1, { message: 'At least one college must be selected' })
  @IsString({ each: true, message: 'Invalid college ID' })
  collegeIds!: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Every negative college ID must be a valid UUID' })
  negativeCollegeIds?: string[];

  @IsEnum(LeadSource)
  source!: LeadSource;

  @IsOptional()
  @IsInt()
  statusId?: number;

  @IsOptional()
  @IsInt()
  teamId?: number;
}
