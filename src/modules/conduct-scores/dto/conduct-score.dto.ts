import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CONDUCT_PERIOD_TYPES, ConductPeriodType } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class UpsertConductScoreDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiProperty()
  @IsMongoId()
  semesterId: string;

  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiProperty({ enum: CONDUCT_PERIOD_TYPES })
  @IsIn(CONDUCT_PERIOD_TYPES)
  periodType: ConductPeriodType;

  @ApiProperty({
    description: 'Month 1–12 for `monthly`; otherwise the semester or year number',
    example: 9,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodValue: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  score: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;
}

export class QueryConductScoresDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;

  @ApiPropertyOptional({ enum: CONDUCT_PERIOD_TYPES })
  @IsIn(CONDUCT_PERIOD_TYPES)
  @IsOptional()
  periodType?: ConductPeriodType;
}
