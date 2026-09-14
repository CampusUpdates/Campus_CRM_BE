import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class ReplaceSuperAdminDto {
  @IsString()
  @IsNotEmpty()
  newSuperAdminId!: string;

  @IsInt()
  @IsNotEmpty()
  newRoleForPreviousAdminId!: number;
}
