import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  EXAM_LEVELS,
  EXAM_REGISTRATION_STATUSES,
  ExamLevel,
  ExamRegistrationStatus,
} from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class CreateExamRegistrationDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiProperty({ enum: EXAM_LEVELS })
  @IsIn(EXAM_LEVELS)
  level: ExamLevel;

  @ApiPropertyOptional({ description: 'Defaults to the active school year' })
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;

  @ApiPropertyOptional({
    description:
      'Semester whose term result the eligibility check reads. Defaults to the active one.',
  })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional({
    description:
      'Register despite failing eligibility. Requires `exams:manage`, and the override plus ' +
      'reason are recorded on the registration and in the audit log.',
  })
  @IsBoolean()
  @IsOptional()
  overrideIneligible?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(10)
  @MaxLength(500)
  overrideReason?: string;
}

export class ApproveExamRegistrationDto {
  @ApiProperty({ description: 'Seat number issued by the exam authority', example: 'VTE-M4-00123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  examNumber: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(150)
  examCenter?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  examDate?: string;
}

export class RejectExamRegistrationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class QueryExamRegistrationsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() schoolYearId?: string;

  @ApiPropertyOptional({ enum: EXAM_LEVELS })
  @IsIn(EXAM_LEVELS)
  @IsOptional()
  level?: ExamLevel;

  @ApiPropertyOptional({ enum: EXAM_REGISTRATION_STATUSES })
  @IsIn(EXAM_REGISTRATION_STATUSES)
  @IsOptional()
  status?: ExamRegistrationStatus;
}

export class ExamSubjectScoreDto {
  @ApiPropertyOptional({ description: 'Links to a subject when the exam maps to one' })
  @IsMongoId()
  @IsOptional()
  subjectId?: string;

  @ApiProperty({ example: 'ຄະນິດສາດ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  subjectNameLo: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxScore: number;
}

export class RecordExamResultDto {
  @ApiProperty()
  @IsMongoId()
  registrationId: string;

  @ApiProperty({ type: [ExamSubjectScoreDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExamSubjectScoreDto)
  subjects: ExamSubjectScoreDto[];

  @ApiPropertyOptional({ description: 'Grade issued by the exam authority' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  resultGrade?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  nationalRank?: number;
}

export class QueryExamResultsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() schoolYearId?: string;

  @ApiPropertyOptional({ enum: EXAM_LEVELS })
  @IsIn(EXAM_LEVELS)
  @IsOptional()
  level?: ExamLevel;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPassed?: boolean;
}

export class EligibilityCheckDto {
  @ApiProperty() isEligible: boolean;
  @ApiProperty({ type: [String] }) failedChecks: string[];
  @ApiProperty({ type: 'object', additionalProperties: true })
  snapshot: Record<string, unknown>;
}
