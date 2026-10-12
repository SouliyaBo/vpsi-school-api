import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MARK_MAX } from '../monthly-grading';

/** Which sheet is being looked at: one subject, in one class, for one term. */
export class SheetQueryDto {
  @ApiProperty()
  @IsMongoId()
  subjectId: string;

  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;
}

export class MonthGridQueryDto extends SheetQueryDto {
  @ApiProperty({ example: 9, description: 'Calendar month, 1–12' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}

/**
 * ສະຫຼຸບປະຈຳເດືອນ — one class, one month, every subject at once.
 *
 * No `subjectId`: this sheet crosses the subjects with each other, which none of
 * the per-subject ones can do. The subjects come from the grade the class sits.
 */
export class ClassMonthQueryDto {
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

/**
 * ຄະແນນປະຈຳເດືອນ of one student — the child's own page rather than a class sheet.
 *
 * No `classroomId` and no `subjectId`: the question is "how has this student
 * done, month by month", and the room they sat in that term is a fact about the
 * register, not something the caller should have to know.
 */
export class StudentMonthsQueryDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;
}

/** The school year an annual sheet covers. */
export class AnnualSheetQueryDto {
  @ApiProperty() @IsMongoId() subjectId: string;
  @ApiProperty() @IsMongoId() classroomId: string;

  @ApiPropertyOptional({ description: 'Defaults to the active school year' })
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;
}

/**
 * One student's four cells for the month.
 *
 * Every column is optional and nullable, because the form is filled in as the
 * month goes: `null` clears a cell back to "not written", which is not the same
 * as a mark of zero.
 *
 * **What each column is out of is not decided here.** It depends on the subject:
 * ສັງຄົມ takes no ປື້ມ mark and its point goes to ກິດຈະກຳ, so that column runs to
 * 3 there and to 2 everywhere else — see `columnMaxFor`. These bounds used to
 * state the ordinary scheme (1 / 1 / 2 / 6), which made this a second copy of a
 * rule that has an owner, and the copy ran first: `ValidationPipe` refused a
 * perfectly legal ກິດຈະກຳ 3 for ສັງຄົມ before the service could consult the
 * subject at all, and the teacher was told only "ຂໍ້ມູນທີ່ສົ່ງມາບໍ່ຖືກຕ້ອງ".
 *
 * So what is left here is the one bound that holds whatever the scheme:
 * no single column can be worth more than the month itself. The real limit is
 * checked in `MonthlyMarksService.saveMonth`, against that subject's own maxima,
 * and refused with `score.exceedsMax` — which names the column and the mark it is
 * actually out of.
 */
export class MonthlyMarkEntryDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({ description: 'ຂື້ນຫ້ອງ — out of 1 under the usual scheme', example: 1 })
  @IsNumber()
  @Min(0)
  @Max(MARK_MAX)
  @IsOptional()
  attendance?: number | null;

  @ApiPropertyOptional({ description: 'ປື້ມ — out of 1, and not marked at all for ສັງຄົມ' })
  @IsNumber()
  @Min(0)
  @Max(MARK_MAX)
  @IsOptional()
  notebook?: number | null;

  @ApiPropertyOptional({ description: 'ກິດຈະກຳ — out of 2, or 3 where ປື້ມ is not marked' })
  @IsNumber()
  @Min(0)
  @Max(MARK_MAX)
  @IsOptional()
  activity?: number | null;

  @ApiPropertyOptional({ description: 'ກວດກາ — out of 6' })
  @IsNumber()
  @Min(0)
  @Max(MARK_MAX)
  @IsOptional()
  test?: number | null;

  /**
   * ເຫດຜົນ — why the month came out as it did, kept with the marks and printed
   * under the subject on ໃບລາຍງານຜູ້ປົກຄອງ.
   *
   * Nullable like the cells: an empty string clears it. A row that has only a
   * remark is kept, so a teacher can write one before the marks are in.
   */
  @ApiPropertyOptional({ description: 'ເຫດຜົນ, shown to the guardian on the month report' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  remark?: string | null;
}

/**
 * A month's marks for a whole class, as the entry form saves them.
 *
 * One request per (subject, class, month, strand): the form is a grid, and
 * saving row by row would leave a half-entered month behind on a lost
 * connection.
 */
export class SaveMonthGridDto extends MonthGridQueryDto {
  @ApiPropertyOptional({
    description:
      'The strand being marked — ຟີຊິກ / ເຄມີ / ຊີວະ. Omit for a subject that is ' +
      'marked as a whole; required for one that declares strands.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  strand?: string;

  @ApiProperty({ type: [MonthlyMarkEntryDto], maxItems: 200 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MonthlyMarkEntryDto)
  entries: MonthlyMarkEntryDto[];

  @ApiPropertyOptional({
    description: 'Required to amend a month that has been submitted; lands in the audit trail.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  overrideReason?: string;
}

/** ສອບເສັງພາກ and ເພີ່ມ for one student. */
export class TermMarkEntryDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({ description: 'ສອບເສັງພາກ, out of 10. Zero is a mark; null is unsat.' })
  @IsNumber()
  @Min(0)
  @Max(10)
  @IsOptional()
  examScore?: number | null;

  @ApiPropertyOptional({ description: 'ເພີ່ມ — added to the term mark, which caps at 10' })
  @IsNumber()
  @Min(0)
  @Max(10)
  @IsOptional()
  bonus?: number | null;
}

export class SaveTermMarksDto extends SheetQueryDto {
  @ApiProperty({ type: [TermMarkEntryDto], maxItems: 200 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TermMarkEntryDto)
  entries: TermMarkEntryDto[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  overrideReason?: string;
}

/** Submitting or reopening one month of the sheet. */
export class LockMonthDto extends MonthGridQueryDto {
  @ApiPropertyOptional({ description: 'One strand only; omit to cover the whole month' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  strand?: string;

  @ApiPropertyOptional({ description: 'Required when reopening' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  reason?: string;
}

/** What a save reports back, mirroring the batch score save. */
export class SaveMarksResultDto {
  @ApiProperty() saved: number;
  @ApiProperty() skipped: number;
  @ApiProperty({ type: [Object] }) errors: { studentId: string; reason: string }[];
}
