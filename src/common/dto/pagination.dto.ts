import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Hard cap so a client cannot ask for an unbounded page. */
export const MAX_PAGE_SIZE = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Field to sort by' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Free-text search term' })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }

  /**
   * Sort spec for Mongo.
   *
   * `sortBy` is whitelisted by the caller (see `toSort`) — never passed through
   * raw, since an arbitrary field name can force an unindexed collection scan.
   */
  toSort(allowedFields: readonly string[], fallback: Record<string, 1 | -1>) {
    if (!this.sortBy || !allowedFields.includes(this.sortBy)) return fallback;
    return { [this.sortBy]: this.sortOrder === 'asc' ? 1 : (-1 as 1 | -1) };
  }
}

export class PaginationMeta {
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
  @ApiProperty() hasNextPage: boolean;
  @ApiProperty() hasPreviousPage: boolean;
}

export class PaginatedResponse<T> {
  @ApiProperty({ isArray: true })
  data: T[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;

  constructor(data: T[], total: number, page: number, limit: number) {
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
    this.data = data;
    this.meta = {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
