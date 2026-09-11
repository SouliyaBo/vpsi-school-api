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
import {
  CALENDAR_EVENT_TYPES,
  CalendarEventType,
  SCHOOL_DAY_EFFECTS,
  SchoolDayEffect,
} from 'src/common/constants/enums';
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

  @ApiPropertyOptional({
    enum: SCHOOL_DAY_EFFECTS,
    description:
      'Whether the school is open, staffed but not teaching, or shut. ' +
      "Defaults to the type's own effect — `holiday` shuts, `exam` suspends the " +
      'timetable, everything else is a normal day.',
  })
  @IsIn(SCHOOL_DAY_EFFECTS)
  @IsOptional()
  dayEffect?: SchoolDayEffect;

  @ApiPropertyOptional({ default: false, description: 'ຄຶ່ງວັນ — a morning only.' })
  @IsBoolean()
  @IsOptional()
  isHalfDay?: boolean;

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

  @ApiPropertyOptional({ enum: SCHOOL_DAY_EFFECTS })
  @IsIn(SCHOOL_DAY_EFFECTS)
  @IsOptional()
  dayEffect?: SchoolDayEffect;

  @ApiPropertyOptional() @IsBoolean() @IsOptional() isHalfDay?: boolean;

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

  @ApiPropertyOptional({ enum: SCHOOL_DAY_EFFECTS })
  @IsIn(SCHOOL_DAY_EFFECTS)
  @IsOptional()
  dayEffect?: SchoolDayEffect;

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

export class QuerySchoolDaysDto {
  @ApiProperty({ example: '2026-08-17', description: 'Inclusive.' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-09-30', description: 'Inclusive.' })
  @IsDateString()
  to: string;
}
