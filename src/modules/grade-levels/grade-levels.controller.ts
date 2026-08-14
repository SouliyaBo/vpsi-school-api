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
import { CreateGradeLevelDto, UpdateGradeLevelDto } from './dto/grade-level.dto';
import { GradeLevelsService } from './grade-levels.service';

@ApiTags('grade-levels')
@ApiBearerAuth()
@Controller('grade-levels')
export class GradeLevelsController {
  constructor(private readonly service: GradeLevelsService) {}

  @Get()
  @ApiOperation({ summary: 'List grade levels, lowest first' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'grade-levels', action: 'create' })
  create(
    @Body() dto: CreateGradeLevelDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'grade-levels', action: 'update' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGradeLevelDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'grade-levels', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
