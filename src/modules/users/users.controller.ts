import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { AdminResetPasswordDto, CreateUserDto } from '../auth/dto/auth.dto';
import { QueryUsersDto, UpdateMyProfileDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  /**
   * Declared before `:id` so the literal path wins the route match — otherwise
   * "me" would be parsed as an id.
   */
  @Patch('me')
  @ApiOperation({ summary: 'Update your own email or interface language' })
  updateMe(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateMyProfileDto,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(actor.sub, dto, { actor, ip });
  }

  @Get()
  @RequirePermissions({ resource: 'users', action: 'read' })
  @ApiOperation({ summary: 'List user accounts' })
  findAll(@Query() query: QueryUsersDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'users', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'users', action: 'create' })
  @ApiOperation({ summary: 'Create a user account' })
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'users', action: 'update' })
  @ApiOperation({
    summary: 'Update an account',
    description: 'Suspending an account or changing its role revokes all of its sessions.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'users', action: 'manage' })
  @ApiOperation({
    summary: 'Set a temporary password for a user',
    description: 'Forces a password change at next login and revokes existing sessions.',
  })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: AdminResetPasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.adminResetPassword(id, dto, { actor, ip });
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'users', action: 'manage' })
  @ApiOperation({ summary: 'Clear a brute-force lockout early' })
  unlock(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.unlock(id, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'users', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
