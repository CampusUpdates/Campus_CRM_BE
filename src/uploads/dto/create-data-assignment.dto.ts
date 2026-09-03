import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { FilterStudentDataDto } from './filter-student-data.dto';

export enum SelectionMode {
  EXPLICIT = 'EXPLICIT',
  ALL_MATCHING = 'ALL_MATCHING',
}

export class CreateDataAssignmentDto {
  @IsNotEmpty()
  @IsUUID()
  assignedToId: string;

  @IsOptional()
  @IsEnum(SelectionMode)
  selectionMode?: SelectionMode = SelectionMode.EXPLICIT;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  studentDataIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => FilterStudentDataDto)
  filters?: FilterStudentDataDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  expiryDays?: number = 4;
}
