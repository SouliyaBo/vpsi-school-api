import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class CreateSchoolYearDto {
  @ApiProperty({ example: '2025-2026' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{4}$/, { message: 'Code must look like "2025-2026"' })
  code: string;

  @ApiProperty({ example: 'ສົກຮຽນ 2025-2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameLo: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  nameEn?: string;

  @ApiProperty({ example: '2025-09-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString()
  endDate: string;
}

export class UpdateSchoolYearDto {
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
}

export class QuerySchoolYearsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
