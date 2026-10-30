import { IsArray, IsNotEmpty, IsString, ArrayMinSize } from 'class-validator';

export class BulkReallocateLeadsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one lead ID must be provided' })
  @IsString({ each: true })
  leadIds: string[];

  @IsString()
  @IsNotEmpty({ message: 'Target user ID is required' })
  targetUserId: string;
}
