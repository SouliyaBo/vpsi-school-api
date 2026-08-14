import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  AllowWhilePasswordChangeRequired,
  ClientIp,
  CurrentUser,
  Public,
} from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Tighter than the global limit: login is the endpoint worth brute-forcing.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate and receive an access/refresh token pair' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials, or account locked/inactive' })
  login(@Body() dto: LoginDto, @Req() req: Request, @ClientIp() ip: string | null) {
    return this.authService.login(dto.username, dto.password, {
      ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Exchange a refresh token for a new pair',
    description:
      'The presented refresh token is invalidated. Replaying an already-rotated token ' +
      'revokes every session for that user.',
  })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @ClientIp() ip: string | null) {
    return this.authService.refresh(dto.refreshToken, {
      ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowWhilePasswordChangeRequired()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentUser('sub') userId: string,
    @Body() dto: Partial<RefreshTokenDto>,
  ): Promise<void> {
    await this.authService.logout(userId, dto?.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowWhilePasswordChangeRequired()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke every session for the current user' })
  async logoutAll(@CurrentUser('sub') userId: string): Promise<void> {
    await this.authService.logout(userId, undefined, true);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowWhilePasswordChangeRequired()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change your own password',
    description: 'Succeeds only with the correct current password. All sessions are revoked.',
  })
  async changePassword(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangePasswordDto,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    await this.authService.changePassword(userId, dto.currentPassword, dto.newPassword, { ip });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiOperation({
    summary: 'Request a password reset token',
    description:
      'Always returns 200 whether or not the username exists, so the endpoint cannot be ' +
      'used to enumerate accounts. With no mail transport configured in this phase, the ' +
      'token is returned in the response for an administrator to relay out of band.',
  })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto.username);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Complete a password reset using the issued token' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Get('me')
  @AllowWhilePasswordChangeRequired()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The authenticated user with their resolved permissions' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
