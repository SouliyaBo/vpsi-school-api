import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LESSON_PLAN_STATUSES, LessonPlanStatus } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class LessonActivityDto {
  @ApiProperty({ example: 'ສົມຜົນກຳລັງສອງ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  topic: string;

  @ApiProperty()
  @IsDateString()
  date: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  durationMinutes?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  objectives?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsOptional()
  materials?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  teachingMethod?: string;

  @ApiPropertyOptional({ description: 'Whether the session was actually taught' })
  @IsBoolean()
  @IsOptional()
  isCompleted?: boolean;

  @ApiPropertyOptional({ description: 'How it went, filled in after teaching' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  reflection?: string;
}

export class CreateLessonPlanDto {
  @ApiProperty()
  @IsMongoId()
  subjectId: string;

  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiProperty()
  @IsMongoId()
  semesterId: string;

  @ApiProperty({ example: 'ແຜນການສອນ ອາທິດທີ 3' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  /**
   * `weekEndDate` and `dueDate` are deliberately absent: the first is the Sunday
   * that closes this week, the second comes from school policy. Both are derived
   * server-side.
   */
  @ApiProperty({
    example: '2025-09-15',
    description: 'Any date in the taught week — snapped to that week’s Monday',
  })
  @IsDateString()
  weekStartDate: string;

  @ApiPropertyOptional({ type: [LessonActivityDto], maxItems: 30 })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => LessonActivityDto)
  @IsOptional()
  activities?: LessonActivityDto[];
}

export class UpdateLessonPlanDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(2000) description?: string;

  /** Moving the week re-derives `weekEndDate` and the deadline along with it. */
  @ApiPropertyOptional({ description: 'Any date in the taught week' })
  @IsDateString()
  @IsOptional()
  weekStartDate?: string;

  @ApiPropertyOptional({ type: [LessonActivityDto], description: 'Replaces the activity list' })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => LessonActivityDto)
  @IsOptional()
  activities?: LessonActivityDto[];
}

export class ReviewLessonPlanDto {
  @ApiProperty({ enum: ['approved', 'returned'] })
  @IsIn(['approved', 'returned'])
  decision: 'approved' | 'returned';

  @ApiPropertyOptional({
    description: 'Required when returning a plan — the teacher needs to know what to fix',
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  comment?: string;
}

export class QueryLessonPlansDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() teacherId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() subjectId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;

  @ApiPropertyOptional({
    description: 'Restricts to plans whose subject belongs to this department',
  })
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string;

  @ApiPropertyOptional({ description: 'Any date in the taught week' })
  @IsDateString()
  @IsOptional()
  weekStartDate?: string;

  @ApiPropertyOptional({ enum: LESSON_PLAN_STATUSES })
  @IsIn(LESSON_PLAN_STATUSES)
  @IsOptional()
  status?: LessonPlanStatus;

  @ApiPropertyOptional({ description: 'Only plans submitted after their deadline' })
  @IsOptional()
  isLate?: string;
}

/**
 * The compliance matrix is not a paginated list — it is one semester read whole,
 * so it takes neither `page` nor `limit`.
 */
export class QueryComplianceDto {
  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional({ description: 'Show only this department' })
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string;

  @ApiPropertyOptional({ description: 'Show only this teacher’s rows' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional({
    description: 'First week to include — any date in it. Defaults to the semester start.',
  })
  @IsDateString()
  @IsOptional()
  fromWeek?: string;

  @ApiPropertyOptional({
    description: 'Last week to include — any date in it. Defaults to the current week.',
  })
  @IsDateString()
  @IsOptional()
  toWeek?: string;
}

export class MarkActivityCompletedDto {
  @ApiProperty({ description: 'Sub-document id of the activity' })
  @IsMongoId()
  activityId: string;

  @ApiProperty()
  @IsBoolean()
  isCompleted: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(1000)
  reflection?: string;
}
