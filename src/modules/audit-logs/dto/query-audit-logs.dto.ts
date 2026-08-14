import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';
import { AUDIT_ACTIONS, AuditAction } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class QueryAuditLogsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ example: 'students' })
  @IsString()
  @IsOptional()
  entityType?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  entityId?: string;

  @ApiPropertyOptional({ enum: AUDIT_ACTIONS })
  @IsIn(AUDIT_ACTIONS)
  @IsOptional()
  action?: AuditAction;

  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive upper bound' })
  @IsDateString()
  @IsOptional()
  to?: string;
}
