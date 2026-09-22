import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class TeamLeadAdvisorAssignmentDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  teamLeadId!: string;

  @IsArray()
  @IsUUID('all', { each: true })
  advisorIds!: string[];
}

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @IsUUID()
  managerId!: string;

  @IsArray()
  @IsUUID('all', { each: true })
  memberIds!: string[];

  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  teamLeadIds?: string[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TeamLeadAdvisorAssignmentDto)
  teamLeadAdvisorAssignments?: TeamLeadAdvisorAssignmentDto[];
}
