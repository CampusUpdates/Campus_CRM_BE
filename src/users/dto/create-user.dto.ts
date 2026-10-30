import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsDateString,
  IsNotEmpty,
  Length,
  Matches,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  @Matches(/^[A-Za-z]+$/, { message: 'First name can only contain letters' })
  firstName!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]+$/, { message: 'Last name can only contain letters' })
  lastName?: string;

  @IsEmail({}, { message: 'Please enter a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(/^\d{10}$/, { message: 'Phone number must be exactly 10 digits' })
  phone!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Alternate phone must be exactly 10 digits' })
  alternatePhone?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Please enter a valid date' })
  dob?: string;

  @IsInt({ message: 'System Role is required' })
  @IsNotEmpty({ message: 'System Role is required' })
  roleId!: number;

  @IsOptional()
  @IsInt()
  teamId?: number;

  @IsOptional()
  @IsString()
  managerId?: string;
}
