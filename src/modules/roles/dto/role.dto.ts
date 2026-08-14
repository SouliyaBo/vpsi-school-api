import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  PermissionAction,
  PermissionResource,
} from 'src/common/constants/enums';

export class PermissionDto {
  @ApiProperty({ enum: PERMISSION_RESOURCES })
  @IsIn(PERMISSION_RESOURCES)
  resource: PermissionResource;

  @ApiProperty({ enum: PERMISSION_ACTIONS, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(PERMISSION_ACTIONS, { each: true })
  actions: PermissionAction[];
}

export class CreateRoleDto {
  @ApiProperty({ example: 'homeroom_teacher' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'Role code may contain only lowercase letters, digits and underscores',
  })
  code: string;

  @ApiProperty({ example: 'ຄູປະຈຳຫ້ອງ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameLo: string;

  @ApiProperty({ example: 'Homeroom Teacher' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: [PermissionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionDto)
  permissions: PermissionDto[];
}

export class UpdateRoleDto {
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
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: [PermissionDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PermissionDto)
  permissions?: PermissionDto[];
}
