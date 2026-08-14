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
import { CreateGuardianDto, QueryGuardiansDto, UpdateGuardianDto } from './dto/guardian.dto';
import { GuardiansService } from './guardians.service';

@ApiTags('guardians')
@ApiBearerAuth()
@Controller('guardians')
export class GuardiansController {
  constructor(private readonly service: GuardiansService) {}

  @Get()
  @RequirePermissions({ resource: 'guardians', action: 'read' })
  findAll(@Query() query: QueryGuardiansDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'guardians', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/children')
  @RequirePermissions({ resource: 'guardians', action: 'read' })
  @ApiOperation({ summary: 'Students linked to this guardian' })
  findChildren(@Param('id') id: string) {
    return this.service.findChildren(id);
  }

  @Post()
  @RequirePermissions({ resource: 'guardians', action: 'create' })
  create(
    @Body() dto: CreateGuardianDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'guardians', action: 'update' })
  @ApiOperation({
    summary: 'Update a guardian',
    description:
      'A change to the name or phone is propagated to the copies embedded on every ' +
      'linked student, in the same transaction.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGuardianDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'guardians', action: 'delete' })
  @ApiOperation({ summary: 'Soft-delete a guardian who is not linked to any student' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
