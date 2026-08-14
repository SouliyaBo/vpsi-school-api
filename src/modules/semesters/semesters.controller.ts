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
import { CreateSemesterDto, QuerySemestersDto, UpdateSemesterDto } from './dto/semester.dto';
import { SemestersService } from './semesters.service';

@ApiTags('semesters')
@ApiBearerAuth()
@Controller('semesters')
export class SemestersController {
  constructor(private readonly service: SemestersService) {}

  @Get('active')
  @ApiOperation({ summary: 'The currently active semester' })
  findActive() {
    return this.service.findActive();
  }

  @Get()
  findAll(@Query() query: QuerySemestersDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'semesters', action: 'create' })
  @ApiOperation({ summary: 'Create a semester within a school year' })
  create(
    @Body() dto: CreateSemesterDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'semesters', action: 'update' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSemesterDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Post(':id/activate')
  @RequirePermissions({ resource: 'semesters', action: 'manage' })
  @ApiOperation({ summary: 'Make this the active semester' })
  activate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.setActive(id, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'semesters', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
