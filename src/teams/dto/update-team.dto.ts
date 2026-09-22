import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { TeamLeadAdvisorAssignmentDto } from './create-team.dto';

export class UpdateTeamDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  memberIds?: string[];

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
