import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

/** One student's mark within a batch entry. */
export class ScoreEntryDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null clears the mark back to ungraded — different from a score of 0',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  score?: number | null;

  @ApiPropertyOptional({ description: 'Records an absence, which scores 0' })
  @IsBoolean()
  @IsOptional()
  isAbsent?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  remark?: string;
}

/**
 * Enters marks for a whole class at once — the shape the grade-entry screen
 * actually needs, rather than one request per student.
 */
export class BatchSaveScoresDto {
  @ApiProperty()
  @IsMongoId()
  componentId: string;

  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiProperty({ type: [ScoreEntryDto], maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ScoreEntryDto)
  entries: ScoreEntryDto[];

  @ApiPropertyOptional({
    description:
      'Required to amend scores that are already locked. Recorded verbatim in the audit log.',
  })
  @IsString()
  @IsOptional()
  @MinLength(10, { message: 'An override reason must be at least 10 characters' })
  @MaxLength(500)
  overrideReason?: string;
}

export class LockScoresDto {
  @ApiProperty()
  @IsMongoId()
  componentId: string;

  @ApiProperty()
  @IsMongoId()
  classroomId: string;
}

export class UnlockScoresDto extends LockScoresDto {
  @ApiProperty({ description: 'Why the lock is being lifted; recorded in the audit log' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class QueryScoresDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() componentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() subjectId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;
}

export class BatchSaveResultDto {
  @ApiProperty() saved: number;
  @ApiProperty() skipped: number;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  errors: { studentId: string; reason: string }[];
}
