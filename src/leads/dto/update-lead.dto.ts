import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  IsNotEmpty,
  Matches,
} from 'class-validator';

import { CourseType, Gender, LeadSource } from '@prisma/client';

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

  @ValidateIf((o) => o.courseInterested === CourseType.OTHER)
  @IsNotEmpty({ message: 'Specify Course is required when course interested is Other' })
  @IsString()
  courseInterestedOther?: string;

  @IsOptional()
  @IsString()
  specializationInterested?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  collegeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  negativeColleges?: string[];

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

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ValidateIf((o) => o.source === LeadSource.OTHER)
  @IsNotEmpty({ message: 'Specify Lead Source is required when source is Other' })
  @IsString()
  sourceOther?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Application ID can contain only letters, numbers, hyphens (-), and underscores (_).',
  })
  applicationId?: string;
}
