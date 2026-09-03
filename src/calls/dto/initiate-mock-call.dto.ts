import { IsNotEmpty, IsString } from 'class-validator';

export class InitiateMockCallDto {
  @IsNotEmpty({ message: 'studentDataId is required' })
  @IsString()
  studentDataId!: string;
}
