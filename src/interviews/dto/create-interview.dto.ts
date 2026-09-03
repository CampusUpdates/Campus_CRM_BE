import { InterviewResult, InterviewStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateInterviewDto {
  @IsUUID()
  @IsNotEmpty()
  candidateId!: string;

  @IsUUID()
  @IsNotEmpty()
  interviewerId!: string;

  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  scheduledAt!: Date;

  @IsOptional()
  @IsEnum(InterviewStatus)
  status?: InterviewStatus;

  @IsOptional()
  @IsEnum(InterviewResult)
  result?: InterviewResult;

  @IsOptional()
  @IsString()
  feedback?: string;
}
