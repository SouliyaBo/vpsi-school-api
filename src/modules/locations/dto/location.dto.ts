import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { LOCATION_TYPES, LocationType } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class CreateLocationDto {
  @ApiProperty({ example: 'ບ້ານໂພນສະຫວັນ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameLo: string;

  @ApiPropertyOptional({ example: 'Ban Phonsavan' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  nameEn?: string;

  @ApiPropertyOptional({ description: 'Official administrative code' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  code?: string;

  @ApiProperty({ enum: LOCATION_TYPES })
  @IsIn(LOCATION_TYPES)
  type: LocationType;

  @ApiPropertyOptional({
    description: 'Required for district (a province) and village (a district); omit for province',
  })
  @IsMongoId()
  @IsOptional()
  parentId?: string;
}

export class UpdateLocationDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(150)
  nameLo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(150)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  code?: string;

  @ApiPropertyOptional({ description: 'Moving a node rewrites the lineage of its whole subtree' })
  @IsMongoId()
  @IsOptional()
  parentId?: string;
}

export class QueryLocationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LOCATION_TYPES })
  @IsIn(LOCATION_TYPES)
  @IsOptional()
  type?: LocationType;

  @ApiPropertyOptional({ description: 'Direct children of this location only' })
  @IsMongoId()
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({
    description: 'Every descendant at any depth, e.g. all villages in a province',
  })
  @IsMongoId()
  @IsOptional()
  ancestorId?: string;
}
