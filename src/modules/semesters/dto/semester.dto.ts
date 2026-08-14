import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SEMESTER_STATUSES, SemesterStatus } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class CreateSemesterDto {
  @ApiProperty()
  @IsMongoId()
  schoolYearId: string;

  @ApiProperty({ minimum: 1, maximum: 4, example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  number: number;

  @ApiProperty({ example: 'ພາກຮຽນທີ 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameLo: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  nameEn?: string;

  @ApiProperty()
  @IsDateString()
  startDate: string;

  @ApiProperty()
  @IsDateString()
  endDate: string;
}

export class UpdateSemesterDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  nameLo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({
    enum: SEMESTER_STATUSES,
    description:
      '`grading` allows score entry but freezes enrollment; `closed` freezes everything.',
  })
  @IsIn(SEMESTER_STATUSES)
  @IsOptional()
  status?: SemesterStatus;
}

export class QuerySemestersDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;

  @ApiPropertyOptional({ enum: SEMESTER_STATUSES })
  @IsIn(SEMESTER_STATUSES)
  @IsOptional()
  status?: SemesterStatus;
}
