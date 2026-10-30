import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateBroadcastDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  body: string;

  @IsOptional()
  @IsBoolean()
  targetAll?: boolean;

  @IsOptional()
  @IsArray()
  targetRoles?: number[];

  @IsOptional()
  @IsArray()
  targetTeams?: number[];

  @IsOptional()
  @IsArray()
  targetUserIds?: string[];
}

export class PreviewRecipientsDto {
  @IsOptional()
  @IsBoolean()
  targetAll?: boolean;

  @IsOptional()
  @IsArray()
  targetRoles?: number[];

  @IsOptional()
  @IsArray()
  targetTeams?: number[];

  @IsOptional()
  @IsArray()
  targetUserIds?: string[];
}

export class QueryBroadcastDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;

  @IsOptional()
  search?: string;

  @IsOptional()
  senderRole?: string;

  @IsOptional()
  senderId?: string;

  @IsOptional()
  teamId?: string;

  @IsOptional()
  time?: string;

  @IsOptional()
  fromDate?: string;

  @IsOptional()
  toDate?: string;

  @IsOptional()
  ackStatus?: 'ALL' | 'ACKNOWLEDGED' | 'PENDING';

  @IsOptional()
  readStatus?: 'ALL' | 'READ' | 'UNREAD';

  @IsOptional()
  inbox?: boolean | string;
}

export class QueryRecipientsDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;

  @IsOptional()
  search?: string;

  @IsOptional()
  teamId?: string;

  @IsOptional()
  roleId?: string;

  @IsOptional()
  readStatus?: 'ALL' | 'READ' | 'UNREAD';

  @IsOptional()
  ackStatus?: 'ALL' | 'ACKNOWLEDGED' | 'PENDING';
}
