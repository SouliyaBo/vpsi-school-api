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
import { ClassroomsService } from './classrooms.service';
import { CreateClassroomDto, QueryClassroomsDto, UpdateClassroomDto } from './dto/classroom.dto';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller('classrooms')
export class ClassroomsController {
  constructor(private readonly service: ClassroomsService) {}

  @Get()
  @ApiOperation({ summary: 'List classrooms for a school year' })
  findAll(@Query() query: QueryClassroomsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One classroom with its grade level and homeroom teacher resolved' })
  findOne(@Param('id') id: string) {
    return this.service.findOnePopulated(id);
  }

  @Post()
  @RequirePermissions({ resource: 'classrooms', action: 'create' })
  create(
    @Body() dto: CreateClassroomDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'classrooms', action: 'update' })
  @ApiOperation({
    summary: 'Update a classroom',
    description: 'Capacity cannot be reduced below the number of students already enrolled.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClassroomDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'classrooms', action: 'delete' })
  @ApiOperation({ summary: 'Soft-delete an empty classroom' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
