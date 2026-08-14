import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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

/**
 * Drafts (or re-drafts) a month.
 *
 * `semesterId` is optional and defaults to the active semester, matching the
 * compliance endpoint — the office works on the term that is running.
 */
export class DraftLessonPlanMonthDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 8, description: 'Calendar month, 1–12' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional({
    description: 'Limits the draft to these departments; omit for the whole school',
  })
  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  subjectGroupIds?: string[];
}

export class UpdateLessonPlanMonthDto {
  @ApiPropertyOptional({ description: 'Instruction shown to every teacher on the list' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}

/** Lines to drop from a draft — an exam week, a holiday, a teacher on leave. */
export class RemoveLessonPlanTasksDto {
  @ApiProperty({ isArray: true, type: String })
  @IsArray()
  @ArrayNotEmpty()
  @IsMongoId({ each: true })
  taskIds: string[];
}

export class UpdateLessonPlanTaskDto {
  @ApiPropertyOptional({ description: 'Overrides the deadline policy for this line' })
  @IsDateString()
  @IsOptional()
  dueDate?: string;
}

export class QueryLessonPlanMonthsDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  year?: number;
}

export class QueryLessonPlanTasksDto {
  @ApiPropertyOptional({ description: 'Defaults to the caller when they are a teacher' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  subjectGroupIds?: string;

  @ApiPropertyOptional({ description: 'Only the lines nothing has been handed in for' })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  outstandingOnly?: boolean;
}
