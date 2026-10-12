import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SUBJECT_TYPES, SubjectType } from 'src/common/constants/enums';
import { MARK_MAX } from 'src/modules/monthly-marks/monthly-grading';
import { SUBJECT_ROLES, SubjectRole } from '../subject-roles';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

/**
 * ຄະແນນເຕັມ of the monthly sheet's four columns, for a subject the school marks
 * differently from the usual ຂື້ນຫ້ອງ 1 · ປື້ມ 1 · ກິດຈະກຳ 2 · ກວດກາ 6.
 *
 * All four are required rather than patched one at a time: half a scheme is not
 * a scheme, and the four have to total 10 — the service refuses a set that does
 * not, since every figure above a month is read on that scale.
 *
 * 0 means the column is **not marked** — ພູມສາດ takes no ປື້ມ at ມ.1 — rather
 * than marked and scored nothing.
 */
export class MonthlyColumnMaxDto {
  @ApiProperty({ description: 'ຂື້ນຫ້ອງ', example: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MARK_MAX)
  attendance: number;

  @ApiProperty({ description: 'ປື້ມ — 0 where the subject keeps no notebook mark', example: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MARK_MAX)
  notebook: number;

  @ApiProperty({ description: 'ກິດຈະກຳ', example: 3 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MARK_MAX)
  activity: number;

  @ApiProperty({ description: 'ກວດກາ', example: 6 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MARK_MAX)
  test: number;
}

export class CreateSubjectDto {
  @ApiProperty({ example: 'MATH-M4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code: string;

  @ApiProperty({ example: 'ຄະນິດສາດ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameLo: string;

  @ApiPropertyOptional({ example: 'Mathematics' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nameEn?: string;

  @ApiProperty()
  @IsMongoId()
  gradeLevelId: string;

  @ApiPropertyOptional({ description: 'Department this subject is taught by' })
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string;

  @ApiPropertyOptional({
    description:
      'The ສາຍວິຊາ this subject is marked under. Set it for a subject the mark sheet ' +
      'splits out (ຟີຊິກສາດ under ທຳມະຊາດ, ພູມສາດ under ສັງຄົມ): the parent stays what ' +
      'teachers are assigned to and roll call is taken against, and this one carries the ' +
      'marks. Must be a subject of the same grade level.',
  })
  @IsMongoId()
  @IsOptional()
  parentSubjectId?: string;

  @ApiPropertyOptional({ enum: SUBJECT_TYPES, default: 'core' })
  @IsIn(SUBJECT_TYPES)
  @IsOptional()
  type?: SubjectType;

  @ApiPropertyOptional({ description: 'Weight when averaging the term result', default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  credits?: number;

  @ApiPropertyOptional({ default: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  hoursPerWeek?: number;

  @ApiPropertyOptional({
    description: 'Where the subject sits in the printed order of the mark sheet, low first',
    default: 0,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['ຟີຊິກ', 'ເຄມີ', 'ຊີວະ'],
    description:
      'The strands the monthly mark sheet splits this subject into, each marked out of 10 ' +
      'and averaged into the month. Leave empty for a subject marked as a whole.',
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @IsOptional()
  strands?: string[];

  @ApiPropertyOptional({
    type: MonthlyColumnMaxDto,
    nullable: true,
    description:
      "The monthly sheet's ຄະແນນເຕັມ for this subject, where they are not the school's " +
      'usual 1 / 1 / 2 / 6. The four must total 10, and a column set to 0 is not marked at ' +
      'all. `null` puts the subject back on the standard columns.',
  })
  @ValidateIf((_object, value) => value !== null)
  @ValidateNested()
  @Type(() => MonthlyColumnMaxDto)
  @IsOptional()
  monthlyColumnMax?: MonthlyColumnMaxDto | null;

  @ApiPropertyOptional({
    description: 'Percentage needed to pass. Falls back to the global grading setting.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  passingPercentage?: number;
}

export class UpdateSubjectDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nameLo?: string;

  /** `null` detaches the subject from its department. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string | null;

  /** `null` makes the subject stand on its own again — taught and marked. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  parentSubjectId?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nameEn?: string;

  @ApiPropertyOptional({ enum: SUBJECT_TYPES })
  @IsIn(SUBJECT_TYPES)
  @IsOptional()
  type?: SubjectType;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  credits?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  hoursPerWeek?: number;

  @ApiPropertyOptional({
    description: 'Where the subject sits in the printed order of the mark sheet, low first',
    default: 0,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['ຟີຊິກ', 'ເຄມີ', 'ຊີວະ'],
    description:
      'The strands the monthly mark sheet splits this subject into, each marked out of 10 ' +
      'and averaged into the month. Leave empty for a subject marked as a whole.',
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @IsOptional()
  strands?: string[];

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  passingPercentage?: number;

  @ApiPropertyOptional({
    type: MonthlyColumnMaxDto,
    nullable: true,
    description:
      "The monthly sheet's ຄະແນນເຕັມ for this subject, where they are not the school's " +
      'usual 1 / 1 / 2 / 6. The four must total 10, and a column set to 0 is not marked at ' +
      'all. `null` puts the subject back on the standard columns.',
  })
  @ValidateIf((_object, value) => value !== null)
  @ValidateNested()
  @Type(() => MonthlyColumnMaxDto)
  @IsOptional()
  monthlyColumnMax?: MonthlyColumnMaxDto | null;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class QuerySubjectsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  gradeLevelId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string;

  @ApiPropertyOptional({
    enum: SUBJECT_ROLES,
    description:
      '`taught` — the ສາຍວິຊາ a teacher is assigned to and roll call is taken against. ' +
      '`marked` — the subjects a mark is recorded against, which from ມ.4 up are the split ' +
      'ones. Unset returns both, which is the subject register.',
  })
  @IsIn(SUBJECT_ROLES)
  @IsOptional()
  role?: SubjectRole;

  @ApiPropertyOptional({ enum: SUBJECT_TYPES })
  @IsIn(SUBJECT_TYPES)
  @IsOptional()
  type?: SubjectType;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
