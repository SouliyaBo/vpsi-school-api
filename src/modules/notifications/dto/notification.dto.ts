import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { NOTIFICATION_TYPES, NotificationType } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class QueryNotificationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter to unread (false) or read (true)' })
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  @IsOptional()
  isRead?: boolean;

  @ApiPropertyOptional({ enum: NOTIFICATION_TYPES })
  @IsIn(NOTIFICATION_TYPES)
  @IsOptional()
  type?: NotificationType;
}
