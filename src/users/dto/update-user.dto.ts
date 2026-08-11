import {
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 50)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsInt()
  roleId?: number;

  @IsOptional()
  @IsInt()
  teamId?: number;

  @IsOptional()
  @IsString()
  managerId?: string;
}