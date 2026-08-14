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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  CreateTeachingAssignmentDto,
  QueryTeachingAssignmentsDto,
  UpdateTeachingAssignmentDto,
} from './dto/teaching-assignment.dto';
import { TeachingAssignmentsService } from './teaching-assignments.service';

@ApiTags('teaching-assignments')
@ApiBearerAuth()
@Controller('teaching-assignments')
export class TeachingAssignmentsController {
  constructor(private readonly service: TeachingAssignmentsService) {}

  @Get()
  @RequirePermissions({ resource: 'teaching-assignments', action: 'read' })
  findAll(@Query() query: QueryTeachingAssignmentsDto) {
    return this.service.findAll(query);
  }

  @Get('teacher/:teacherId/semester/:semesterId')
  @RequirePermissions({ resource: 'teaching-assignments', action: 'read' })
  @ApiOperation({ summary: "A teacher's timetable for a semester" })
  teacherSchedule(@Param('teacherId') teacherId: string, @Param('semesterId') semesterId: string) {
    return this.service.findTeacherSchedule(teacherId, semesterId);
  }

  @Get('classroom/:classroomId/semester/:semesterId')
  @RequirePermissions({ resource: 'teaching-assignments', action: 'read' })
  @ApiOperation({ summary: "A classroom's timetable for a semester" })
  classroomSchedule(
    @Param('classroomId') classroomId: string,
    @Param('semesterId') semesterId: string,
  ) {
    return this.service.findClassroomSchedule(classroomId, semesterId);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'teaching-assignments', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'teaching-assignments', action: 'create' })
  @ApiOperation({
    summary: 'Assign a teacher to a subject in a classroom',
    description:
      'Rejected on any timetable clash: the same teacher, the same classroom, or the same ' +
      'physical room already booked in an overlapping period. The response body lists every ' +
      'conflict found.',
  })
  @ApiResponse({ status: 409, description: 'Schedule conflict; see `details.conflicts`' })
  create(
    @Body() dto: CreateTeachingAssignmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'teaching-assignments', action: 'update' })
  @ApiOperation({ summary: 'Update an assignment; a new schedule is re-checked for conflicts' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTeachingAssignmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'teaching-assignments', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
