import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PERSON_TYPES, PersonType, USER_STATUSES, UserStatus } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { SUPPORTED_LOCALES } from 'src/common/i18n/messages';

export class QueryUsersDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  roleId?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsIn(USER_STATUSES)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({ enum: PERSON_TYPES })
  @IsIn(PERSON_TYPES)
  @IsOptional()
  personType?: PersonType;
}

/**
 * Deliberately excludes `password`, `username`, `personType` and `personId`.
 * A password change goes through the dedicated reset endpoint so it is always
 * audited as one; the identity fields are immutable once an account exists.
 */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  roleId?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsIn(USER_STATUSES)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({ enum: SUPPORTED_LOCALES })
  @IsIn(SUPPORTED_LOCALES)
  @IsOptional()
  locale?: string;
}

export class UpdateMyProfileDto {
  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_LOCALES })
  @IsIn(SUPPORTED_LOCALES)
  @IsOptional()
  @IsString()
  locale?: string;
}
