import { InterviewResult, InterviewStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateInterviewDto {
  @IsOptional()
  @IsUUID()
  interviewerId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

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
