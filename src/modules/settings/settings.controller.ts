import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Public, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { UpsertSettingDto } from './dto/setting.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Public()
  @Get('public')
  @ApiOperation({
    summary: 'Settings flagged public',
    description:
      'Unauthenticated: the login screen needs the school name and default locale before ' +
      'anyone has a token. Only settings explicitly marked `isPublic` are returned.',
  })
  findPublic() {
    return this.service.findAll(undefined, true);
  }

  @Get()
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'settings', action: 'read' })
  findAll(@Query('category') category?: string) {
    return this.service.findAll(category);
  }

  @Get(':key')
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'settings', action: 'read' })
  findOne(@Param('key') key: string) {
    return this.service.findOne(key);
  }

  @Put()
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'settings', action: 'update' })
  @ApiOperation({ summary: 'Create or update a setting' })
  upsert(
    @Body() dto: UpsertSettingDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.upsert(dto, actor, ip);
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'settings', action: 'delete' })
  remove(
    @Param('key') key: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(key, actor, ip);
  }
}
