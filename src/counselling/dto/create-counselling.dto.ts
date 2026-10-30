import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CounsellingItemDto {
  @IsNotEmpty({ message: 'College ID is required' })
  @IsUUID('4', { message: 'Invalid college UUID' })
  collegeId!: string;

  @IsOptional()
  @IsString()
  preferredDate?: string;

  @IsOptional()
  @IsString()
  preferredTime?: string;

  @IsOptional()
  @IsString()
  preferredTiming?: string;

  @IsOptional()
  @IsString()
  purpose?: string;
}

export class CreateCounsellingDto {
  @IsArray({ message: 'Requests must be an array' })
  @ValidateNested({ each: true })
  @Type(() => CounsellingItemDto)
  requests!: CounsellingItemDto[];
}
