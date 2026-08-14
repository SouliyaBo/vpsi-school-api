import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
