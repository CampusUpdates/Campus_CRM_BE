import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignTeamLeadDto {
  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
