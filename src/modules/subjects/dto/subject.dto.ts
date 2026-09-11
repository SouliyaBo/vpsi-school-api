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
} from 'class-validator';
import { SUBJECT_TYPES, SubjectType } from 'src/common/constants/enums';
import { SUBJECT_ROLES, SubjectRole } from '../subject-roles';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

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
