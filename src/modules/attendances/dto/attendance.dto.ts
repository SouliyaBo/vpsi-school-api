import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ATTENDANCE_STATUSES, AttendanceStatus } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class AttendanceEntryDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  @IsIn(ATTENDANCE_STATUSES)
  status: AttendanceStatus;

  @ApiPropertyOptional({ description: 'Only meaningful when status is `late`' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minutesLate?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  reason?: string;
}

/**
 * Records a whole class's attendance for one timetabled lesson.
 *
 * The lesson is the only thing the client names. Classroom, subject, semester,
 * teacher and period are all read off the assignment server-side, so a caller
 * cannot record attendance for a class they do not teach or for a subject that
 * is not on the timetable that day.
 */
export class RecordAttendanceDto {
  @ApiProperty({ description: 'The timetabled lesson being registered' })
  @IsMongoId()
  teachingAssignmentId: string;

  @ApiProperty({
    example: '2025-09-15',
    description: 'Normalized to UTC midnight; must fall on a day the lesson is scheduled',
  })
  @IsDateString()
  date: string;

  @ApiProperty({ type: [AttendanceEntryDto], maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries: AttendanceEntryDto[];
}

export class QueryAttendancesDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() subjectId?: string;

  @ApiPropertyOptional({ description: 'The teacher whose lesson it was, per the timetable' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional() @IsMongoId() @IsOptional() teachingAssignmentId?: string;

  @ApiPropertyOptional({ enum: ATTENDANCE_STATUSES })
  @IsIn(ATTENDANCE_STATUSES)
  @IsOptional()
  status?: AttendanceStatus;

  @ApiPropertyOptional({ description: 'Inclusive lower bound' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound' })
  @IsDateString()
  @IsOptional()
  to?: string;
}

export class AttendanceSummaryDto {
  @ApiProperty() studentId: string;
  @ApiProperty() present: number;
  @ApiProperty() absent: number;
  @ApiProperty() late: number;
  @ApiProperty() excused: number;
  @ApiProperty() sick: number;
  @ApiProperty() totalRecorded: number;
  @ApiProperty({ description: 'Present + late + excused + sick, over total recorded' })
  attendanceRate: number;
}

/**
 * The same counts, broken down by subject.
 *
 * Needed because the overall summary cannot answer "how many maths lessons did
 * this student miss" — with one lesson per school day, a student who skips every
 * Monday loses one whole subject while their overall rate stays comfortable.
 */
export class AttendanceSubjectSummaryDto extends AttendanceSummaryDto {
  @ApiProperty() subjectId: string;
  @ApiProperty({ nullable: true }) subjectCode: string | null;
  @ApiProperty({ nullable: true }) subjectNameLo: string | null;
  @ApiProperty({ nullable: true }) subjectNameEn: string | null;
}
