import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FEEDBACK_STATUSES, FeedbackStatus } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class SubmitFeedbackDto {
  @ApiProperty({ example: 'ຂໍ້ສະເໜີກ່ຽວກັບຕາຕະລາງຮຽນ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  message: string;

  @ApiPropertyOptional({ example: 'ຕາຕະລາງ' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({
    description:
      'When true, nothing identifying is stored — not your user id and not your IP. The ' +
      'submission cannot be traced back to you, and you will not receive a notification.',
  })
  @IsBoolean()
  @IsOptional()
  isAnonymous?: boolean;

  @ApiPropertyOptional({
    description: 'Optional contact address, useful with an anonymous submission',
  })
  @IsEmail()
  @IsOptional()
  contactEmail?: string;
}

export class RespondFeedbackDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(5000)
  response: string;

  @ApiPropertyOptional({ enum: FEEDBACK_STATUSES, default: 'resolved' })
  @IsIn(FEEDBACK_STATUSES)
  @IsOptional()
  status?: FeedbackStatus;
}

export class UpdateFeedbackStatusDto {
  @ApiProperty({ enum: FEEDBACK_STATUSES })
  @IsIn(FEEDBACK_STATUSES)
  status: FeedbackStatus;
}

export class QueryFeedbackDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FEEDBACK_STATUSES })
  @IsIn(FEEDBACK_STATUSES)
  @IsOptional()
  status?: FeedbackStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(60)
  category?: string;
}
