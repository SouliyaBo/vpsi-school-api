import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import {
  TEACHING_OBSERVATION_STATUSES,
  TeachingObservationStatus,
} from 'src/common/constants/enums';
import { CRITERION_KEYS, OBSERVATION_CRITERIA } from '../observation-rubric';

/** One row of the sheet as the client sends it. */
export class ObservationScoreDto {
  @ApiProperty({ enum: CRITERION_KEYS, example: CRITERION_KEYS[0] })
  @IsIn(CRITERION_KEYS as string[])
  criterion: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10,
    nullable: true,
    description:
      'The mark out of ten. `null` clears the row back to unmarked, which is not a mark of zero.',
  })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(10)
  @IsOptional()
  score?: number | null;
}

export class CreateTeachingObservationDto {
  @ApiProperty({ description: 'ຊື່ຜູ້ຖືກປະເມີນ (ຄູສອນ) — the teacher being observed' })
  @IsMongoId()
  teacherId: string;

  @ApiPropertyOptional({
    description:
      'ຜູ້ຕິດຕາມ — the teacher doing the observing. Defaults to the signed-in teacher; the ' +
      'office must name one when keying in somebody else’s paper sheet.',
  })
  @IsMongoId()
  @IsOptional()
  observerId?: string;

  @ApiProperty({ description: 'ວິຊາທີ່ສອນ' })
  @IsMongoId()
  subjectId: string;

  @ApiProperty({ description: 'ຫ້ອງ' })
  @IsMongoId()
  classroomId: string;

  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiProperty({ description: 'ວັນທີ — the day of the visit', example: '2026-09-07' })
  @IsDateString()
  observedAt: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'ປະເມີນຄັ້ງທີ. Derived when omitted, as this observer’s next visit to this teacher’s ' +
      'lesson in this subject this term.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  visitNumber?: number;

  @ApiPropertyOptional({
    type: [ObservationScoreDto],
    description: `One row per criterion: ${OBSERVATION_CRITERIA.map((c) => c.key).join(', ')}`,
  })
  @IsArray()
  @ArrayMaxSize(OBSERVATION_CRITERIA.length)
  @ValidateNested({ each: true })
  @Type(() => ObservationScoreDto)
  @IsOptional()
  scores?: ObservationScoreDto[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  note?: string;
}

/**
 * `teacherId`, `semesterId` and `visitNumber` are absent by design.
 *
 * They are what the sheet *is* — which teacher, which term, which visit — and a
 * sheet that could be reassigned to a different colleague after the fact is not
 * a record. A sheet filed against the wrong teacher is withdrawn and rewritten.
 */
export class UpdateTeachingObservationDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  observerId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  classroomId?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  observedAt?: string;

  @ApiPropertyOptional({
    type: [ObservationScoreDto],
    description: 'A criterion left out keeps its mark; sent as `null` it is cleared.',
  })
  @IsArray()
  @ArrayMaxSize(OBSERVATION_CRITERIA.length)
  @ValidateNested({ each: true })
  @Type(() => ObservationScoreDto)
  @IsOptional()
  scores?: ObservationScoreDto[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  note?: string;
}

/**
 * Which run of visits a sheet belongs to, and so what ປະເມີນຄັ້ງທີ the form
 * should offer.
 *
 * The classroom is absent because it is not counted within — see the schema.
 */
export class NextVisitQueryDto {
  @ApiProperty({ description: 'ຊື່ຜູ້ຖືກປະເມີນ (ຄູສອນ)' })
  @IsMongoId()
  teacherId: string;

  @ApiPropertyOptional({ description: 'ຜູ້ຕິດຕາມ — defaults to the signed-in teacher' })
  @IsMongoId()
  @IsOptional()
  observerId?: string;

  @ApiProperty({ description: 'ວິຊາທີ່ສອນ' })
  @IsMongoId()
  subjectId: string;

  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;
}

export class QueryTeachingObservationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'The observed teacher' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional({ description: 'The teacher who did the observing' })
  @IsMongoId()
  @IsOptional()
  observerId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  classroomId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional({ enum: TEACHING_OBSERVATION_STATUSES })
  @IsIn(TEACHING_OBSERVATION_STATUSES as readonly string[])
  @IsOptional()
  status?: TeachingObservationStatus;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsDateString()
  @IsOptional()
  to?: string;
}

export class ObservationSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional({ description: 'Limits the summary to one department' })
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string;
}
