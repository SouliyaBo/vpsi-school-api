import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

/** One named student on a row of the register, with what they did. */
export class BehaviorEntryDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({ description: 'ພຶດຕິກຳ(ລາຍບຸກຄົນ) — what this student did' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  behavior?: string;

  @ApiPropertyOptional({
    description: 'ຕັດຄະແນນ/ຕັກເຕືອນ — free text, as written on the paper form',
    example: 'ເຕືອນ 2 ຄັ້ງ',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  action?: string;
}

/**
 * One row of the behaviour register.
 *
 * The lesson is the only thing the client names; classroom, semester, subject,
 * teacher and period are read off the assignment server-side, so a row cannot be
 * filed against a lesson that is not on the timetable that day.
 *
 * `entries` may be empty, because the paper form allows a row that records only
 * the state of the class with no student named. What is refused is a row that is
 * empty on both counts — see `behaviorLog.emptyRow`.
 */
export class CreateBehaviorLogDto {
  @ApiProperty({ description: 'The timetabled lesson the observation was made in' })
  @IsMongoId()
  teachingAssignmentId: string;

  @ApiProperty({
    example: '2025-11-06',
    description: 'Normalized to UTC midnight; must fall on a day the lesson is scheduled',
  })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ description: 'ສະພາບລວມພາຍໃນຫ້ອງ — the class as a whole' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  classNote?: string;

  @ApiPropertyOptional({ description: 'ໝາຍເຫດ' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;

  @ApiPropertyOptional({ type: [BehaviorEntryDto], maxItems: 100, default: [] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BehaviorEntryDto)
  @IsOptional()
  entries?: BehaviorEntryDto[];
}

/**
 * Replaces a whole row.
 *
 * Same shape as the create, minus the lesson and the date: moving a row to a
 * different lesson would change every denormalized field on it, and is a delete
 * plus a re-entry rather than an edit.
 */
export class UpdateBehaviorLogDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  classNote?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;

  @ApiPropertyOptional({ type: [BehaviorEntryDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BehaviorEntryDto)
  @IsOptional()
  entries?: BehaviorEntryDto[];
}

export class QueryBehaviorLogsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() subjectId?: string;

  @ApiPropertyOptional({ description: 'The teacher whose lesson it was, per the timetable' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional() @IsMongoId() @IsOptional() teachingAssignmentId?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound' })
  @IsDateString()
  @IsOptional()
  to?: string;
}

/**
 * How much of the term a tally covers.
 *
 * Everything is optional, and omitting all three is the whole semester — which
 * is what the screen asks for until the reader narrows it. The same trio the
 * attendance summary takes, and for the same reason: "this term" and "since the
 * parents' meeting in October" are different questions, and only one of them
 * could be asked before.
 */
export class BehaviorTallyQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive lower bound, yyyy-MM-dd' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound, yyyy-MM-dd' })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Only entries written in this subject’s lessons' })
  @IsMongoId()
  @IsOptional()
  subjectId?: string;
}

/** The month the printable sheet covers. */
export class MonthlySheetQueryDto {
  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiProperty({ example: 2025 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 11, minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}
