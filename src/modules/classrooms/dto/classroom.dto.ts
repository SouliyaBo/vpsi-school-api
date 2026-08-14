import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class CreateClassroomDto {
  @ApiProperty()
  @IsMongoId()
  schoolYearId: string;

  @ApiProperty()
  @IsMongoId()
  gradeLevelId: string;

  @ApiProperty({ description: 'Section name within the grade', example: 'ກ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  name: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  homeroomTeacherId?: string;

  @ApiPropertyOptional({ default: 45 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({ description: 'Physical room', example: 'A101' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  room?: string;
}

export class UpdateClassroomDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  name?: string;

  @ApiPropertyOptional({ description: 'Pass null to clear the homeroom teacher' })
  @IsMongoId()
  @IsOptional()
  homeroomTeacherId?: string | null;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  room?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class QueryClassroomsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  gradeLevelId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  homeroomTeacherId?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
