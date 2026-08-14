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
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get()
  @RequirePermissions({ resource: 'roles', action: 'read' })
  @ApiOperation({ summary: 'List roles with their permission matrices' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'roles', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'roles', action: 'create' })
  @ApiOperation({ summary: 'Create a role' })
  create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'roles', action: 'update' })
  @ApiOperation({
    summary: 'Update a role',
    description: 'The permissions of a system role cannot be changed.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'roles', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
