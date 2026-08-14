import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class CreateSubjectGroupDto {
  @ApiProperty({ example: 'science' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^[a-z0-9_-]+$/, { message: 'Code may contain only lowercase letters, digits, _ and -' })
  code: string;

  @ApiProperty({ example: 'ສາຍວິທະຍາສາດ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameLo: string;

  @ApiPropertyOptional({ example: 'Science' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nameEn?: string;

  @ApiPropertyOptional({ description: 'The head who reviews this group’s lesson plans' })
  @IsMongoId()
  @IsOptional()
  headTeacherId?: string;

  @ApiPropertyOptional({ description: 'Display order on menus and the compliance matrix' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateSubjectGroupDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) nameLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) nameEn?: string;

  /**
   * Passing `null` clears the head, which is how a group is left vacant.
   * `ValidateIf` is what lets the null through — `IsMongoId` alone rejects it.
   */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  headTeacherId?: string | null;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class QuerySubjectGroupsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
