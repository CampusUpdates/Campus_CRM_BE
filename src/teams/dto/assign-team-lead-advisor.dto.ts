import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignTeamLeadAdvisorDto {
  @IsNotEmpty()
  @IsUUID()
  advisorId: string;
}
