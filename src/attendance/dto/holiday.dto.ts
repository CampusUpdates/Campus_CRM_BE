import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class HolidayDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
