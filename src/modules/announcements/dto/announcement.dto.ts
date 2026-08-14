import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_TARGET_TYPES,
  AnnouncementPriority,
  AnnouncementTargetType,
} from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class AnnouncementTargetDto {
  @ApiProperty({
    enum: ANNOUNCEMENT_TARGET_TYPES,
    description:
      '`all`, `teachers` and `guardians` need no id; `role`, `grade_level` and `classroom` do.',
  })
  @IsIn(ANNOUNCEMENT_TARGET_TYPES)
  targetType: AnnouncementTargetType;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  targetId?: string;
}

export class CreateAnnouncementDto {
  @ApiProperty({ example: 'ປິດພັກຮຽນວັນບຸນທາດຫລວງ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titleLo: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  titleEn?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  contentLo: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(10_000)
  contentEn?: string;

  @ApiProperty({ type: [AnnouncementTargetDto], maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementTargetDto)
  targets: AnnouncementTargetDto[];

  @ApiPropertyOptional({ enum: ANNOUNCEMENT_PRIORITIES, default: 'normal' })
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  @IsOptional()
  priority?: AnnouncementPriority;

  @ApiPropertyOptional({ description: 'After this moment the announcement leaves the feed' })
  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPinned?: boolean;
}

export class UpdateAnnouncementDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) titleLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) titleEn?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(10_000) contentLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(10_000) contentEn?: string;

  @ApiPropertyOptional({ type: [AnnouncementTargetDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementTargetDto)
  @IsOptional()
  targets?: AnnouncementTargetDto[];

  @ApiPropertyOptional({ enum: ANNOUNCEMENT_PRIORITIES })
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  @IsOptional()
  priority?: AnnouncementPriority;

  @ApiPropertyOptional() @IsDateString() @IsOptional() expiresAt?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isPinned?: boolean;
}

export class QueryAnnouncementsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ANNOUNCEMENT_PRIORITIES })
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  @IsOptional()
  priority?: AnnouncementPriority;

  @ApiPropertyOptional({ description: 'Admin view: include drafts' })
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @ApiPropertyOptional({ description: 'Include announcements past their expiry' })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  includeExpired?: boolean;
}

export class PublishResultDto {
  @ApiProperty() published: boolean;
  @ApiProperty({ description: 'How many users were notified' }) notified: number;
}
