import { IsOptional, IsString } from 'class-validator';

export class CompleteCounsellingDto {
  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  revert?: string;

  @IsOptional()
  @IsString()
  counsellingDate?: string;
}
