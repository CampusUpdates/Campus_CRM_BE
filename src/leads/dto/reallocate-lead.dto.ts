import { IsString, IsNotEmpty } from 'class-validator';

export class ReallocateLeadDto {
  @IsString()
  @IsNotEmpty()
  targetUserId: string;
}
