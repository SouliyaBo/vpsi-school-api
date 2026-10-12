import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ENROLLMENT_STATUSES, EnrollmentStatus } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

/** Shared so the three places that accept the field describe it the same way. */
const ENGLISH_CLASS_DESCRIPTION =
  '`ຫ້ອງພາກອັງກິດ` — the English-programme room, as the office writes it. ' +
  'Unrelated to the homeroom classroom.';

export class CreateEnrollmentDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsDateString()
  @IsOptional()
  enrolledAt?: string;

  @ApiPropertyOptional({ description: ENGLISH_CLASS_DESCRIPTION, example: 'EP-A' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  englishClass?: string;
}

/** One row of a bulk enroll. */
export class BulkEnrollmentItemDto {
  @ApiProperty({ description: 'Student code, matched against `students.studentCode`' })
  @IsString()
  @IsNotEmpty()
  studentCode: string;

  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiPropertyOptional({ description: ENGLISH_CLASS_DESCRIPTION, example: 'EP-A' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  englishClass?: string;
}

export class BulkEnrollDto {
  @ApiProperty({ type: [BulkEnrollmentItemDto], maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkEnrollmentItemDto)
  items: BulkEnrollmentItemDto[];
}

/**
 * Edits to a placement that are not a move.
 *
 * Only `englishClass`: the classroom, year and grade are what a transfer is for,
 * and letting them be patched here would leave the classroom headcounts wrong.
 */
export class UpdateEnrollmentDto {
  @ApiPropertyOptional({
    description: `${ENGLISH_CLASS_DESCRIPTION} Send an empty string to clear it.`,
    example: 'EP-A',
  })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  englishClass?: string;
}

export class ChangeEnrollmentStatusDto {
  @ApiProperty({ enum: ENROLLMENT_STATUSES })
  @IsIn(ENROLLMENT_STATUSES)
  status: EnrollmentStatus;

  @ApiPropertyOptional({ description: 'Required when transferring within the school' })
  @IsMongoId()
  @IsOptional()
  transferredToClassroomId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

export class QueryEnrollmentsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() schoolYearId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() gradeLevelId?: string;

  @ApiPropertyOptional({ enum: ENROLLMENT_STATUSES })
  @IsIn(ENROLLMENT_STATUSES)
  @IsOptional()
  status?: EnrollmentStatus;

  /** Exact match, so an English room can be listed the way a classroom can. */
  @ApiPropertyOptional({ description: ENGLISH_CLASS_DESCRIPTION, example: 'EP-A' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  englishClass?: string;
}

export class BulkEnrollResultDto {
  @ApiProperty() enrolled: number;
  @ApiProperty() failed: number;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'One entry per rejected row, with the reason',
  })
  errors: { studentCode: string; reason: string }[];
}
