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
import {
  CreateSubjectGroupDto,
  QuerySubjectGroupsDto,
  UpdateSubjectGroupDto,
} from './dto/subject-group.dto';
import { SubjectGroupsService } from './subject-groups.service';

@ApiTags('subject-groups')
@ApiBearerAuth()
@Controller('subject-groups')
export class SubjectGroupsController {
  constructor(private readonly service: SubjectGroupsService) {}

  @Get()
  @RequirePermissions({ resource: 'subject-groups', action: 'read' })
  @ApiOperation({ summary: 'List subject groups, in display order' })
  findAll(@Query() query: QuerySubjectGroupsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'subject-groups', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'subject-groups', action: 'create' })
  create(
    @Body() dto: CreateSubjectGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'subject-groups', action: 'update' })
  @ApiOperation({
    summary: 'Rename a group or change its head',
    description: 'Send `headTeacherId: null` to leave the group without a head.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubjectGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'subject-groups', action: 'delete' })
  @ApiOperation({
    summary: 'Delete a group no subject or teacher is filed under',
    description: 'Rejected with a conflict while anything still references it.',
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
