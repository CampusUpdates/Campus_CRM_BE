import { IsBoolean } from 'class-validator';

export class UpdateCollegeStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
