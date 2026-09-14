import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StudentDataItemDto {
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;
}

export class CreateDataUploadDto {
  @IsNotEmpty()
  @IsString()
  fileName: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudentDataItemDto)
  records: StudentDataItemDto[];
}
