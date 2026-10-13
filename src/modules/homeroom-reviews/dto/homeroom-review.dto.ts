import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  GUARDIAN_CONTACT_CHANNELS,
  GuardianContactChannel,
  HOMEROOM_REVIEW_ACTIONS,
  HomeroomReviewAction,
} from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

/**
 * One child the teacher is answering for.
 *
 * `reasons` is deliberately absent: the sheet is recomputed server-side when the
 * review is filed and the reasons are snapshotted from *that*, so a client cannot
 * write a review that claims a child was flagged for something they were not. The
 * teacher's contribution is what they did about it.
 */
export class HomeroomReviewStudentDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiProperty({
    enum: HOMEROOM_REVIEW_ACTIONS,
    description: '`none` is a real answer — a child looked at and judged fine',
  })
  @IsEnum(HOMEROOM_REVIEW_ACTIONS)
  action: HomeroomReviewAction;

  @ApiPropertyOptional({
    enum: GUARDIAN_CONTACT_CHANNELS,
    description: 'How the guardian was reached; refused unless the action reached one',
  })
  @IsEnum(GUARDIAN_CONTACT_CHANNELS)
  @IsOptional()
  contactChannel?: GuardianContactChannel;

  @ApiPropertyOptional({ description: 'ໝາຍເຫດ — what was said' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}

/**
 * ຢືນຢັນການຕິດຕາມ — the homeroom teacher confirming they checked their class.
 *
 * `dueDate` is the ວັນພຸດ/ວັນສຸກ the review answers for, and is left out by the
 * screen: the server resolves it to the most recent review day the calendar owes
 * up to today, which is what a teacher filing on Thursday morning actually means.
 * It is accepted so the office can file a paper review for a named earlier day.
 *
 * `students` may be empty — a class with nothing wrong in it is the good outcome,
 * and a review that found nothing is still a review. The room is not the client's
 * to choose freely either: a teacher may only confirm a room they are the
 * homeroom teacher of.
 */
export class CreateHomeroomReviewDto {
  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiPropertyOptional({
    example: '2026-09-23',
    description: 'The review day this answers for; defaults to the most recent one owed',
  })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional({ type: [HomeroomReviewStudentDto], maxItems: 100, default: [] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => HomeroomReviewStudentDto)
  @IsOptional()
  students?: HomeroomReviewStudentDto[];

  @ApiPropertyOptional({ description: 'ໝາຍເຫດ — the class as a whole' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}

/**
 * Amends a review already filed.
 *
 * The room and the day are not editable: a review is *of* a room *for* a day, and
 * changing either makes it a different review — which is what filing against the
 * other day is for. The filing time is not editable at all, which is what keeps
 * the punctuality report honest.
 */
export class UpdateHomeroomReviewDto {
  @ApiPropertyOptional({ type: [HomeroomReviewStudentDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => HomeroomReviewStudentDto)
  @IsOptional()
  students?: HomeroomReviewStudentDto[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}

/** What the entry screen reads: one room's sheet for one review day. */
export class ReviewSheetQueryDto {
  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiPropertyOptional({
    example: '2026-09-23',
    description: 'Defaults to the most recent review day the calendar owes up to today',
  })
  @IsDateString()
  @IsOptional()
  dueDate?: string;
}

/** ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ — one room, one month. */
export class MonthlyReportQueryDto {
  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiProperty({ example: 9, description: 'Calendar month, 1–12' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;
}

/** ນັກຮຽນທີ່ຮຽນເພີ່ມ — one row as the teacher wrote it. */
export class MonthlyReportExtraClassDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({ description: 'ວິຊາທີ່ຮຽນ, from the subject list' })
  @IsMongoId()
  @IsOptional()
  subjectId?: string;

  @ApiPropertyOptional({
    description:
      'ວິຊາທີ່ຮຽນ as typed — kept for rows written before the picker; ignored with `subjectId`',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ description: 'ອາຈານທີ່ສອນ, from the staff list' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional({
    description:
      'ອາຈານທີ່ສອນ as typed — kept for rows written before the picker; ignored with `teacherId`',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  teacherName?: string;
}

/** ການເຄື່ອນໄຫວພາຍນອກທີ່ພົ້ນເດັ່ນ — one row as the teacher wrote it. */
export class MonthlyReportActivityDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({ example: '2026-10-15', description: 'ວ/ດ/ປ ທີ່ເຄື່ອນໄຫວ' })
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiProperty({ description: 'ລາຍລະອຽດ' })
  @IsString()
  @MaxLength(1000)
  detail: string;
}

/** III. ການພົວພັນຜູ້ປົກຄອງ — one contact the teacher records by hand. */
export class MonthlyReportGuardianContactDto {
  @ApiPropertyOptional({ description: 'Required unless `allStudents`' })
  @ValidateIf((row: MonthlyReportGuardianContactDto) => !row.allStudents)
  @IsMongoId()
  studentId?: string;

  @ApiPropertyOptional({ description: 'The contact went to every guardian in the room' })
  @IsBoolean()
  @IsOptional()
  allStudents?: boolean;

  @ApiProperty({ example: '2026-10-15', description: 'ວ.ດ.ປ ທີ່ພົວພັນ' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'ເນື້ອໃນການພົວພັນ' })
  @IsString()
  @MaxLength(1000)
  content: string;
}

/**
 * The teacher's part of the monthly report — the four sections the system
 * cannot fill. Sent whole each time: a save replaces what was there.
 */
export class SaveMonthlyReportDto extends MonthlyReportQueryDto {
  @ApiPropertyOptional({ description: 'I. ສະພາບລວມ' })
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  overview?: string;

  @ApiProperty({ type: [MonthlyReportExtraClassDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MonthlyReportExtraClassDto)
  extraClasses: MonthlyReportExtraClassDto[];

  @ApiProperty({ type: [MonthlyReportActivityDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MonthlyReportActivityDto)
  outsideActivities: MonthlyReportActivityDto[];

  @ApiPropertyOptional({ type: [MonthlyReportGuardianContactDto] })
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MonthlyReportGuardianContactDto)
  guardianContacts?: MonthlyReportGuardianContactDto[];

  @ApiPropertyOptional({ description: 'IV. ຂໍ້ສະເໜີ' })
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  suggestions?: string;
}

/** The office's grid of monthly reports — a term, defaulting to the active one. */
export class MonthlyReportComplianceQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;
}

/**
 * The office's window.
 *
 * Defaults to the active term to date, like the other two oversight reports, so
 * the screen opens on the answer rather than on a pair of empty date boxes.
 */
export class ReviewComplianceQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  classroomId?: string;

  @ApiPropertyOptional({ description: 'ຄູປະຈຳຫ້ອງ, not the teacher who typed it in' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional({
    description: 'Narrows the rows to the rooms behind; the summary still covers the window',
  })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  outstandingOnly?: boolean;
}

export class QueryHomeroomReviewsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() teacherId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsDateString()
  @IsOptional()
  to?: string;
}
