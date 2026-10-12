import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

/** Times are `HH:mm` local wall-clock — see the SchedulePeriod schema for why. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Time must be in 24-hour HH:mm format, e.g. 08:00';

export class SchedulePeriodDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday … 6 = Saturday' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  startTime: string;

  @ApiProperty({ example: '08:50' })
  @IsString()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  endTime: string;

  @ApiPropertyOptional({ description: 'Physical room; checked for double-booking when set' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  room?: string;

  @ApiPropertyOptional({ description: 'Period number in the daily timetable' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  periodNumber?: number;

  @ApiPropertyOptional({
    description:
      'A slot two teachers take turns in — one takes ມ.2/ກ while the other takes ມ.2/ຂ, ' +
      'then they trade. Teacher, class and room clashes are waived against other periods ' +
      'that also set this, and only against those.',
  })
  @IsBoolean()
  @IsOptional()
  isRotating?: boolean;
}

export class CreateTeachingAssignmentDto {
  @ApiProperty()
  @IsMongoId()
  teacherId: string;

  @ApiProperty()
  @IsMongoId()
  subjectId: string;

  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiProperty()
  @IsMongoId()
  semesterId: string;

  @ApiProperty({ type: [SchedulePeriodDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SchedulePeriodDto)
  schedule: SchedulePeriodDto[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

export class UpdateTeachingAssignmentDto {
  @ApiPropertyOptional({ type: [SchedulePeriodDto], description: 'Replaces the whole schedule' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SchedulePeriodDto)
  @IsOptional()
  schedule?: SchedulePeriodDto[];

  /**
   * The first day the new `schedule` applies to. Defaults to today.
   *
   * The timetable is a fact about each day, not about now: every report derives
   * which days a lesson was owed on by reading its weekday, so a schedule replaced
   * in place used to change the weeks behind it as well — the Mondays a teacher
   * taught and marked stopped counting, and Wednesdays they never taught appeared
   * as gaps, right back to the start of term.
   *
   * Today by default, because "from now on" is what a timetable revision means and
   * forgetting to say so is the failure this exists to prevent. Backdate it — to
   * the start of term, say — to correct an arrangement that was always wrong,
   * which is the one case where rewriting the past is what the office wants.
   */
  @ApiPropertyOptional({
    example: '2026-10-06',
    description: 'First day the new schedule applies to; defaults to today',
  })
  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'ເຫດຜົນ — kept with the schedule spell it closes' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  scheduleNote?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

export class QueryTeachingAssignmentsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() teacherId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() subjectId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
