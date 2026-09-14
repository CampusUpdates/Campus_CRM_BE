import { IsInt, IsOptional, ValidateIf } from 'class-validator';

export class UpdateUserTeamDto {
  @IsOptional()
  @ValidateIf((_, val) => val !== null)
  @IsInt()
  teamId?: number | null;
}
