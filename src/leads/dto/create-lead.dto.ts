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
  Matches,
  ValidateIf,
  IsEmpty,
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

  @ValidateIf((o) => o.courseInterested === CourseType.OTHER)
  @IsNotEmpty({ message: 'Specify Course is required when course interested is Other' })
  @IsString()
  courseInterestedOther?: string;

  @IsOptional()
  @IsString()
  specializationInterested?: string;

  @IsOptional()
  @IsInt()
  passingYear?: number;

  // Family Information
  @IsOptional()
  @IsString()
  fatherName?: string;

  @IsOptional()
  @IsString()
  fatherOccupation?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$/, { message: 'Father phone number must be exactly 10 digits' })
  fatherPhone?: string;

  @IsOptional()
  @IsString()
  aadharNumber?: string;

  @IsOptional()
  @IsString()
  motherName?: string;

  @IsOptional()
  @IsString()
  motherOccupation?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$/, { message: 'Mother phone number must be exactly 10 digits' })
  motherPhone?: string;

  @IsOptional()
  @IsString()
  physicalAddress?: string;

  // 10th Academic Information
  @IsOptional()
  @IsString()
  tenthSchoolName?: string;

  @IsOptional()
  @IsString()
  tenthBoard?: string;

  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  tenthPassoutYear?: number;

  // 12th Academic Information
  @IsOptional()
  @IsString()
  twelfthSchoolName?: string;

  @IsOptional()
  @IsString()
  twelfthBoard?: string;

  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  twelfthPassoutYear?: number;

  // Graduation Information
  @IsOptional()
  @IsString()
  graduationCollegeName?: string;


  @IsOptional()
  @IsString()
  graduationUniversity?: string;

  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  graduationPassoutYear?: number;

  // Calling / Notes
  @IsOptional()
  @IsString()
  bestTimeToCall?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray({ message: 'At least one college must be selected' })
  @ArrayMinSize(1, { message: 'At least one college must be selected' })
  @IsString({ each: true, message: 'Invalid college ID' })
  collegeIds!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  negativeColleges?: string[];

  @IsEnum(LeadSource)
  source!: LeadSource;

  @ValidateIf((o) => o.source === LeadSource.OTHER)
  @IsNotEmpty({ message: 'Specify Lead Source is required when source is Other' })
  @IsString()
  sourceOther?: string;

  @IsOptional()
  @IsInt()
  statusId?: number;

  @IsOptional()
  @IsInt()
  teamId?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Application ID can contain only letters, numbers, hyphens (-), and underscores (_).',
  })
  applicationId?: string;
}
