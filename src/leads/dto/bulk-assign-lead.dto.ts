import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class BulkAssignLeadDto {
  @IsNotEmpty({ message: 'Quantity is required' })
  @IsInt({ message: 'Quantity must be an integer' })
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity!: number;

  @IsNotEmpty({ message: 'Target user ID is required' })
  @IsString()
  targetUserId!: string;

  @IsOptional()
  @IsInt()
  teamId?: number;
}
