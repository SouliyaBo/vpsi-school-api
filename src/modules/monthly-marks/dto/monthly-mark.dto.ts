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
 */
export class MonthlyMarkEntryDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({ description: 'ຂື້ນຫ້ອງ, out of 1', example: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  attendance?: number | null;

  @ApiPropertyOptional({ description: 'ປື້ມ, out of 1' })
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  notebook?: number | null;

  @ApiPropertyOptional({ description: 'ກິດຈະກຳ, out of 2' })
  @IsNumber()
  @Min(0)
  @Max(2)
  @IsOptional()
  activity?: number | null;

  @ApiPropertyOptional({ description: 'ກວດກາ, out of 6' })
  @IsNumber()
  @Min(0)
  @Max(6)
  @IsOptional()
  test?: number | null;
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
