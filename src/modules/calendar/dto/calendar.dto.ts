import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsHexColor,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CALENDAR_EVENT_TYPES, CalendarEventType } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { AnnouncementTargetDto } from 'src/modules/announcements/dto/announcement.dto';

export class CreateCalendarEventDto {
  @ApiProperty({ example: 'ວັນບຸນທາດຫລວງ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titleLo: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  titleEn?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: CALENDAR_EVENT_TYPES })
  @IsIn(CALENDAR_EVENT_TYPES)
  type: CalendarEventType;

  @ApiProperty({ example: '2025-11-05' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2025-11-07' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isAllDay?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ description: 'Defaults to the active school year' })
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;

  @ApiPropertyOptional({
    type: [AnnouncementTargetDto],
    description: 'Empty means the event is school-wide',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementTargetDto)
  @IsOptional()
  targets?: AnnouncementTargetDto[];

  @ApiPropertyOptional({ example: '#1565c0' })
  @IsHexColor()
  @IsOptional()
  colorHex?: string;
}

export class UpdateCalendarEventDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) titleLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) titleEn?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(2000) description?: string;

  @ApiPropertyOptional({ enum: CALENDAR_EVENT_TYPES })
  @IsIn(CALENDAR_EVENT_TYPES)
  @IsOptional()
  type?: CalendarEventType;

  @ApiPropertyOptional() @IsDateString() @IsOptional() startDate?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() endDate?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isAllDay?: boolean;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) location?: string;

  @ApiPropertyOptional({ type: [AnnouncementTargetDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementTargetDto)
  @IsOptional()
  targets?: AnnouncementTargetDto[];

  @ApiPropertyOptional()
  @IsHexColor()
  @IsOptional()
  colorHex?: string;
}

export class QueryCalendarEventsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CALENDAR_EVENT_TYPES })
  @IsIn(CALENDAR_EVENT_TYPES)
  @IsOptional()
  type?: CalendarEventType;

  @ApiPropertyOptional() @IsMongoId() @IsOptional() schoolYearId?: string;

  @ApiPropertyOptional({ description: 'Events overlapping this range — inclusive lower bound' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound' })
  @IsDateString()
  @IsOptional()
  to?: string;
}
