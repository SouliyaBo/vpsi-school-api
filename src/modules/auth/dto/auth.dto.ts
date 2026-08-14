import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PERSON_TYPES, PersonType } from 'src/common/constants/enums';

/**
 * Password policy, applied wherever a password is set.
 *
 * Requires a lower-case letter, an upper-case letter, and a digit. Symbols are
 * allowed but not required — mandating them pushes users toward predictable
 * substitutions without adding real entropy.
 */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 8 characters and contain a lowercase letter, an uppercase letter, and a digit';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  username: string;

  @ApiProperty({ example: 'Passw0rd!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}

export class RequestPasswordResetDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  username: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}

/** Admin-initiated reset — issues a temporary password, no email round-trip. */
export class AdminResetPasswordDto {
  @ApiProperty({ description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  temporaryPassword: string;
}

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9._-]+$/, {
    message: 'Username may contain only lowercase letters, digits, dot, underscore and hyphen',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  username: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password: string;

  @ApiProperty()
  @IsMongoId()
  roleId: string;

  @ApiProperty({ enum: PERSON_TYPES })
  @IsString()
  personType: PersonType;

  @ApiPropertyOptional({ description: 'Required unless personType is "staff"' })
  @IsMongoId()
  @IsOptional()
  personId?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  mustChangePassword?: boolean;
}

// ── Responses ───────────────────────────────────────────────────────────────

export class AuthTokensDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ description: 'Access token lifetime in seconds' }) expiresIn: number;
  @ApiProperty({ default: 'Bearer' }) tokenType: string;
}

export class AuthUserDto {
  @ApiProperty() id: string;
  @ApiProperty() username: string;
  @ApiProperty() roleCode: string;
  @ApiProperty({ enum: PERSON_TYPES }) personType: PersonType;
  @ApiPropertyOptional({ nullable: true }) personId: string | null;
  @ApiProperty() mustChangePassword: boolean;
  @ApiProperty() locale: string;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  permissions: { resource: string; actions: string[] }[];
}

export class LoginResponseDto {
  @ApiProperty({ type: AuthTokensDto }) tokens: AuthTokensDto;
  @ApiProperty({ type: AuthUserDto }) user: AuthUserDto;
}
