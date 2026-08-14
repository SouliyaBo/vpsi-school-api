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
  CreateSchoolYearDto,
  QuerySchoolYearsDto,
  UpdateSchoolYearDto,
} from './dto/school-year.dto';
import { SchoolYearsService } from './school-years.service';

@ApiTags('school-years')
@ApiBearerAuth()
@Controller('school-years')
export class SchoolYearsController {
  constructor(private readonly service: SchoolYearsService) {}

  @Get('active')
  @ApiOperation({ summary: 'The currently active school year' })
  findActive() {
    return this.service.findActive();
  }

  @Get()
  findAll(@Query() query: QuerySchoolYearsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'school-years', action: 'create' })
  @ApiOperation({ summary: 'Create a school year (dates must not overlap an existing one)' })
  create(
    @Body() dto: CreateSchoolYearDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'school-years', action: 'update' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSchoolYearDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Post(':id/activate')
  @RequirePermissions({ resource: 'school-years', action: 'manage' })
  @ApiOperation({
    summary: 'Make this the active school year',
    description: 'Deactivates the previously active year in the same transaction.',
  })
  activate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.setActive(id, { actor, ip });
  }

  @Post(':id/close')
  @RequirePermissions({ resource: 'school-years', action: 'manage' })
  @ApiOperation({ summary: 'Close a school year without deleting its data' })
  close(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.close(id, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'school-years', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
