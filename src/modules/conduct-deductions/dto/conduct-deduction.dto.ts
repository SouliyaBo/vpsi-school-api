import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

// ── The rule sheet ──────────────────────────────────────────────────────────

export class CreateConductRuleDto {
  @ApiProperty({ description: 'The number the printed sheet gives it', example: '2.3' })
  @IsString()
  @MaxLength(16)
  code: string;

  @ApiProperty({ description: 'ຕັດ N ຄະແນນ/ຄັ້ງ', minimum: 1, maximum: 100, example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  points: number;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  nameLo: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  nameEn?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Position within its points column' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  sortOrder?: number;
}

/** Every field optional; the code may be corrected, since it is the sheet's own. */
export class UpdateConductRuleDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(16) code?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  points?: number;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(300) nameLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(300) nameEn?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;

  @ApiPropertyOptional() @Type(() => Number) @IsInt() @IsOptional() sortOrder?: number;
}

export class QueryConductRulesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Narrow to one points column' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  points?: number;

  @ApiPropertyOptional({ description: 'Defaults to the rules currently in force' })
  // `Type(() => Boolean)` would read the string "false" as true — every
  // non-empty string is truthy — so the value is compared rather than cast.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  includeWithdrawn?: boolean;
}

// ── The ledger ──────────────────────────────────────────────────────────────

/**
 * One act of the discipline sheet: one rule, one day, and the children it was
 * applied to.
 *
 * Several students in one request because that is how it happens — a rule is
 * broken by a group, and the teacher writes them down together. The API still
 * files one row per child, since the balance, the appeal and the revocation are
 * all per child.
 *
 * Semester, school year and the points are all resolved server-side, from the
 * date and the rule: a client cannot file a deduction into a term it did not
 * happen in, nor decide what a rule costs.
 */
export class RecordConductDeductionDto {
  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiProperty()
  @IsMongoId()
  ruleId: string;

  @ApiProperty({ description: '`yyyy-MM-dd`; normalized to UTC midnight', example: '2026-09-14' })
  @IsDateString()
  date: string;

  @ApiProperty({ type: [String], description: 'The students the rule was applied to' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(60)
  @IsMongoId({ each: true })
  studentIds: string[];

  @ApiPropertyOptional({ description: 'ໝາຍເຫດ — the circumstances' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

export class QueryConductDeductionsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() ruleId?: string;

  @ApiPropertyOptional({ description: 'Inclusive `yyyy-MM-dd` lower bound' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive `yyyy-MM-dd` upper bound' })
  @IsDateString()
  @IsOptional()
  to?: string;
}

/**
 * Revoking asks for a reason.
 *
 * A deduction is something a child was told about, so withdrawing it is a
 * decision in its own right rather than an undo — the reason is what the audit
 * trail and any later appeal are read from.
 */
export class RevokeConductDeductionDto {
  @ApiProperty({ example: 'ບັນທຶກຜິດຄົນ' })
  @IsString()
  @MaxLength(300)
  reason: string;
}
