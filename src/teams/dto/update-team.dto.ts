import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

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
}
