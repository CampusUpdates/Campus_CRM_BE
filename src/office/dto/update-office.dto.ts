import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateOfficeDto {
  @IsOptional()
  @IsString()
  name?: string;

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
  @IsLatitude()
  latitude?: number | null;

  @IsOptional()
  @IsLongitude()
  longitude?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  radiusMeters?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOfficeStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
