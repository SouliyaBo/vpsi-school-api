import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SCORE_COMPONENT_TYPES, ScoreComponentType } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class CreateScoreComponentDto {
  @ApiProperty()
  @IsMongoId()
  subjectId: string;

  @ApiProperty()
  @IsMongoId()
  semesterId: string;

  @ApiPropertyOptional({
    description: 'Scope to one classroom. Omit to apply to every class taking the subject.',
  })
  @IsMongoId()
  @IsOptional()
  classroomId?: string;

  @ApiProperty({ example: 'ສອບເສັງກາງພາກ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameLo: string;

  @ApiPropertyOptional({ example: 'Midterm exam' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nameEn?: string;

  @ApiProperty({ enum: SCORE_COMPONENT_TYPES })
  @IsIn(SCORE_COMPONENT_TYPES)
  type: ScoreComponentType;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: 'Percentage of the subject mark. All components must total 100.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weight: number;

  @ApiProperty({ example: 20, description: 'Raw maximum score for this component' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxScore: number;

  @ApiPropertyOptional({ default: 0 })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dueDate?: string;
}

export class UpdateScoreComponentDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) nameLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) nameEn?: string;

  @ApiPropertyOptional({ enum: SCORE_COMPONENT_TYPES })
  @IsIn(SCORE_COMPONENT_TYPES)
  @IsOptional()
  type?: ScoreComponentType;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  weight?: number;

  @ApiPropertyOptional({ description: 'Cannot be changed once scores have been recorded' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxScore?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dueDate?: string;
}

export class QueryScoreComponentsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() subjectId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
}

export class WeightSummaryDto {
  @ApiProperty() totalWeight: number;
  @ApiProperty() isValid: boolean;
  @ApiProperty() componentCount: number;
}
