import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpsertSettingDto {
  @ApiProperty({ example: 'grading.passingPercentage' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(\.[a-z0-9]+)*$/i, {
    message: 'Key must be dot-separated alphanumeric segments, e.g. grading.scale',
  })
  key: string;

  @ApiProperty({
    description: 'Any JSON value. The shape is specific to each key.',
    example: 50,
  })
  @IsDefined()
  value: unknown;

  @ApiPropertyOptional({ default: 'general' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({
    description: 'Public settings are readable without authentication — never put secrets here',
  })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;
}
