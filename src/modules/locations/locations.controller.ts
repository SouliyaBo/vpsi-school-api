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
import { CreateLocationDto, QueryLocationsDto, UpdateLocationDto } from './dto/location.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly service: LocationsService) {}

  @Get('tree')
  @ApiOperation({
    summary: 'The full province → district → village hierarchy',
    description: 'Cached for one hour; the cache is invalidated on any write.',
  })
  getTree() {
    return this.service.getTree();
  }

  @Get()
  @ApiOperation({ summary: 'Search locations, optionally scoped to a parent or ancestor' })
  findAll(@Query() query: QueryLocationsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'locations', action: 'create' })
  create(
    @Body() dto: CreateLocationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'locations', action: 'update' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'locations', action: 'delete' })
  @ApiOperation({ summary: 'Soft-delete a location that has no children' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
