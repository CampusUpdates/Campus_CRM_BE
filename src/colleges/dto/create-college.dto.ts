import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCollegeDto {
  @IsString()
  name!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  admissionProcess?: string;

  @IsOptional()
  @IsBoolean()
  hasTieUp?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
