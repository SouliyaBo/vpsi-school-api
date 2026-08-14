import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGradeLevelDto {
  @ApiProperty({ example: 'm4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^[a-z0-9_-]+$/, { message: 'Code may contain only lowercase letters, digits, _ and -' })
  code: string;

  @ApiProperty({ example: 'ມັດທະຍົມສຶກສາປີທີ 4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameLo: string;

  @ApiPropertyOptional({ example: 'Grade 10' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  nameEn?: string;

  @ApiProperty({ description: 'Ordering key used when promoting students', example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  level: number;

  @ApiPropertyOptional({ description: 'True for levels with a national exit exam (m4, m7)' })
  @IsBoolean()
  @IsOptional()
  isExitLevel?: boolean;
}

export class UpdateGradeLevelDto {
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  level?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isExitLevel?: boolean;
}
