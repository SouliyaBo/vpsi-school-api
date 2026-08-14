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
