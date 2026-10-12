import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
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

  @ApiPropertyOptional({
    description:
      'Every record that is not a plain `present` — the lessons behind the absent, late, ' +
      'excused and sick counts of a summary, in one request rather than four. Ignored when ' +
      '`status` names one.',
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  notPresent?: boolean;

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
 * Narrows a summary to a window, and optionally to one subject.
 *
 * The monthly mark sheet prints ວັນຂາດ for the month it is headed with, while
 * every other reader of this summary — exam eligibility, the guardian meeting —
 * wants the term to date. So the window is a parameter and the default is the
 * whole term, rather than two endpoints over the same counts. `from`/`to` are
 * for the office reading a stretch that is not a calendar month — the weeks
 * before an exam, say — and `subjectId` for one teacher's own lessons; either
 * narrows the counts and the rate alike.
 */
export class ClassAttendanceSummaryQueryDto {
  @ApiPropertyOptional({ example: 9, description: 'Calendar month 1–12; omit for the whole term' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  month?: number;

  @ApiPropertyOptional({ description: 'Inclusive `yyyy-MM-dd` lower bound' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive `yyyy-MM-dd` upper bound' })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Count only this subject’s lessons' })
  @IsMongoId()
  @IsOptional()
  subjectId?: string;
}

/**
 * The school-wide list: who has been absent `minAbsentDays` days or more.
 *
 * The office's own thresholds are 15 and 30 days of ວັນຂາດ — with and without
 * a reason together — in a term, and the question is asked across every room,
 * so this takes the class summary's window and adds the threshold and an
 * optional room.
 */
export class SemesterAbsencesQueryDto extends ClassAttendanceSummaryQueryDto {
  @ApiProperty({
    example: 15,
    description: 'List a student once their ວັນຂາດ (ມີເຫດຜົນ + ບໍ່ມີເຫດຜົນ) reach this many days',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minAbsentDays: number;

  @ApiPropertyOptional({ description: 'One room only; every room without' })
  @IsMongoId()
  @IsOptional()
  classroomId?: string;
}

export class AttendanceSummaryDto {
  @ApiProperty() studentId: string;
  @ApiProperty() present: number;
  @ApiProperty({ description: 'Marked absent outright' }) absent: number;
  @ApiProperty({ description: 'Every late arrival, before any became an absence' }) late: number;
  @ApiProperty() excused: number;
  @ApiProperty() sick: number;
  @ApiProperty() totalRecorded: number;

  // ── ວັນຂາດ as the office reads it — see `absence-days.ts` ─────────────────
  @ApiProperty({ description: 'Absences made of late arrivals: one per `latesPerAbsence`' })
  lateAsAbsent: number;
  @ApiProperty({ description: 'Lates left over once those absences are taken out' })
  lateRemainder: number;
  @ApiProperty({ description: 'ຂາດບໍ່ມີເຫດຜົນ: `absent` + `lateAsAbsent`' })
  absentUnexcused: number;
  @ApiProperty({ description: 'ຂາດມີເຫດຜົນ: `excused` + `sick`' })
  absentExcused: number;
  @ApiProperty({ description: '`absentUnexcused` + `absentExcused`' })
  absentTotal: number;
  @ApiProperty({ description: 'The rule these figures were counted under' })
  latesPerAbsence: number;
  @ApiProperty({
    description:
      'Present + late + excused + sick, less the lates that became absences, over total recorded',
  })
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

/** One student over the threshold, named, with the room they sat the lessons in. */
export class AttendanceAbsenceRowDto extends AttendanceSummaryDto {
  @ApiProperty({ nullable: true }) studentCode: string | null;
  @ApiProperty({ nullable: true }) studentNameLo: string | null;
  @ApiProperty({ nullable: true }) studentNickname: string | null;
  @ApiProperty({ nullable: true, description: 'Where they were most recently marked' })
  classroomId: string | null;
  @ApiProperty({ nullable: true }) classroomName: string | null;
  @ApiProperty({ nullable: true }) gradeLevelCode: string | null;
}
