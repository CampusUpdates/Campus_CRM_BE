import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsDateString,
  IsNotEmpty,
  Length,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 50)
  firstName!: string;

  @IsOptional()
  @IsString()
  @Length(2, 50)
  lastName?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsInt()
  roleId!: number;

  @IsOptional()
  @IsInt()
  teamId?: number;

  @IsOptional()
  @IsString()
  managerId?: string;
}