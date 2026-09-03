import { IsNotEmpty, IsString } from 'class-validator';

export class AssignLeadDto {
  @IsNotEmpty({ message: 'Target user ID is required' })
  @IsString()
  targetUserId!: string;
}
