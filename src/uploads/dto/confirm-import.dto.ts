import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class ConfirmImportDto {
  @IsObject()
  @IsNotEmpty()
  actions: Record<string, string>;
}
