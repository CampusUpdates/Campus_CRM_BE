import { IsArray, IsString } from 'class-validator';

export class AssignTpcDto {
  @IsString()
  leadId: string;

  @IsArray()
  @IsString({ each: true })
  assignedToIds: string[];
}
