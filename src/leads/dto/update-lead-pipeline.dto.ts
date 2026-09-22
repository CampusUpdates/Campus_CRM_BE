import {
  IsInt,
  IsOptional,
  IsString,
  IsObject,
  ValidateNested,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InterviewScheduleDto {
  @IsOptional()
  @IsString()
  scheduledAt?: string;
}

export class InterviewResultDto {
  @IsOptional()
  @IsString()
  result?: string;

  @IsOptional()
  @IsString()
  feedback?: string;

  @IsOptional()
  @IsString()
  conductedAt?: string;
}

export class SelectionLetterDto {
  @IsOptional()
  @IsString()
  issuedAt?: string;

  @IsOptional()
  @IsString()
  admissionLastDate?: string;

  @IsOptional()
  @IsString()
  letterUrl?: string;
}

export class AdmissionDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  paymentMode?: string;

  @IsOptional()
  @IsString()
  transactionRef?: string;

  @IsOptional()
  @IsString()
  paidAt?: string;
}

export class CancellationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateLeadPipelineDto {
  @IsInt()
  statusId: number;

  @IsOptional()
  @IsString()
  collegeId?: string;

  @IsOptional()
  @IsString()
  leadCollegeId?: string;

  @IsOptional()
  @IsString()
  applicationId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => InterviewScheduleDto)
  interview?: InterviewScheduleDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => InterviewResultDto)
  interviewResult?: InterviewResultDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SelectionLetterDto)
  selectionLetter?: SelectionLetterDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AdmissionDto)
  admission?: AdmissionDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CancellationDto)
  cancellation?: CancellationDto;
}
