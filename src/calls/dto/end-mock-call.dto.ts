import { IsNotEmpty, IsString } from 'class-validator';

export class EndMockCallDto {
  @IsNotEmpty({ message: 'callId is required' })
  @IsString()
  callId!: string;
}
