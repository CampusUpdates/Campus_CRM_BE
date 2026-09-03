import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateInteractionDto {
  @IsUUID()
  @IsNotEmpty()
  leadId: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsNotEmpty()
  description: string;
}
