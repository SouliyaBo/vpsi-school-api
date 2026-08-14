import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  REPORT_STATUSES,
  REPORT_TYPES,
  ReportStatus,
  ReportType,
} from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class CreateReportTemplateDto {
  @ApiProperty({ example: 'report-card-default' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, { message: 'Code may contain lowercase letters, digits and hyphens' })
  code: string;

  @ApiProperty({ example: 'ໃບລາຍງານຜົນການຮຽນ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameLo: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nameEn?: string;

  @ApiProperty({ enum: REPORT_TYPES })
  @IsIn(REPORT_TYPES)
  type: ReportType;

  @ApiProperty({
    description:
      'Layout definition. See src/modules/reports/pdf/layout.types.ts for the section schema.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  layout: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['lo', 'en'], default: 'lo' })
  @IsIn(['lo', 'en'])
  @IsOptional()
  locale?: string;
}

export class UpdateReportTemplateDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) nameLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) nameEn?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsObject()
  @IsOptional()
  layout?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['lo', 'en'] })
  @IsIn(['lo', 'en'])
  @IsOptional()
  locale?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class QueryReportTemplatesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REPORT_TYPES })
  @IsIn(REPORT_TYPES)
  @IsOptional()
  type?: ReportType;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/** Queues a report card for one student. */
export class GenerateReportCardDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiProperty()
  @IsMongoId()
  semesterId: string;

  @ApiPropertyOptional({ description: 'Defaults to the active template for this report type' })
  @IsMongoId()
  @IsOptional()
  templateId?: string;
}

/** Queues a report card for every student in a classroom. */
export class GenerateClassReportsDto {
  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiProperty()
  @IsMongoId()
  semesterId: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  templateId?: string;
}

export class QueryGeneratedReportsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REPORT_TYPES })
  @IsIn(REPORT_TYPES)
  @IsOptional()
  type?: ReportType;

  @ApiPropertyOptional({ enum: REPORT_STATUSES })
  @IsIn(REPORT_STATUSES)
  @IsOptional()
  status?: ReportStatus;

  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;
}

export class ReportQueuedDto {
  @ApiProperty() reportId: string;
  @ApiProperty() jobId: string;
  @ApiProperty({ example: 'queued' }) status: string;
}

export class BatchReportQueuedDto {
  @ApiProperty() queued: number;
  @ApiProperty({ type: [ReportQueuedDto] }) reports: ReportQueuedDto[];
}

export class ReportDownloadDto {
  @ApiProperty({ description: 'Short-lived signed URL' }) url: string;
  @ApiProperty() expiresInSeconds: number;
}
