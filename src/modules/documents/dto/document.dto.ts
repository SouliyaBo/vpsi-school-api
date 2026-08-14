import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DOCUMENT_VISIBILITIES, DocumentVisibility } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class UploadDocumentDto {
  @ApiProperty({ example: 'ລະບຽບການນຸ່ງເຄື່ອງແບບ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 'ລະບຽບການ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category: string;

  @ApiPropertyOptional({ type: [String], maxItems: 15 })
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @IsOptional()
  // Sent as a repeated field or comma-separated list in multipart form data.
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : value,
  )
  tags?: string[];

  @ApiPropertyOptional({
    enum: DOCUMENT_VISIBILITIES,
    default: 'staff',
    description: 'Who may see this document. Defaults to the most restrictive option.',
  })
  @IsIn(DOCUMENT_VISIBILITIES)
  @IsOptional()
  visibility?: DocumentVisibility;
}

export class UpdateDocumentDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60) category?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 15 })
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ enum: DOCUMENT_VISIBILITIES })
  @IsIn(DOCUMENT_VISIBILITIES)
  @IsOptional()
  visibility?: DocumentVisibility;
}

export class QueryDocumentsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ description: 'Exact tag match' })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  tag?: string;
}
